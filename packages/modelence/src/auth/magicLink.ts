import { z } from 'zod';
import { randomBytes, randomInt } from 'crypto';

import { Args, ConnectionInfo, Context } from '@/methods/types';
import { ObjectId, RouteParams, RouteResponse } from '@/server';
import { usersCollection, magicLinkTokensCollection } from './db';
import { getEmailConfig } from '@/app/emailConfig';
import { getAuthConfig } from '@/app/authConfig';
import { time } from '@/time';
import { htmlToText } from '@/utils';
import { validateEmail } from './validators';
import { consumeRateLimit } from '@/server';
import { getConfig } from '@/config/server';
import { isDisposableEmail } from './disposableEmails';
import { setAuthTokenCookie, setSessionUser } from './session';
import { hashToken } from './tokenHash';
import { magicLinkTemplate } from './templates/magicLinkTemplate';
import {
  resolveUrl,
  resolveUniqueHandle,
  serializeUserForClient,
  isDuplicateEmailError,
} from './utils';
import { Session, User } from './types';

// Short-lived httpOnly cookie carrying the magic link token from the landing
// route to the `loginWithMagicLink` mutation, so it never appears on a
// client-rendered URL.
const MAGIC_LINK_COOKIE = 'magicLinkToken';

// Scope the cookie to the API surface so it's only sent on the loginWithMagicLink request.
const MAGIC_LINK_COOKIE_PATH = '/api/_internal/';

// Attributes shared by the set and clear calls. Browsers only remove a cookie
// when the clearing Set-Cookie matches the same path/secure/sameSite/httpOnly,
// so both sites must use these identical flags or the httpOnly cookie can linger.
const MAGIC_LINK_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // `lax` so the cookie survives the email-link navigation; `strict` can drop
  // it when the SPA is reached cross-site (some webviews).
  sameSite: 'lax',
  path: MAGIC_LINK_COOKIE_PATH,
} as const;

const MAGIC_LINK_EXPIRY_MINUTES = 15;

const ONE_TIME_CODE_LENGTH = 6;

// A 6-digit code is guessable in a way a 32-byte token is not, so each doc
// tolerates only a few wrong guesses before it can no longer be used.
const MAX_CODE_ATTEMPTS = 5;

/**
 * Invokes a notify-only auth hook (onAfterLogin, onLoginError, ...) without
 * letting it affect the auth flow. These hooks are typed `() => void`, but a
 * user can still pass an async function — a rejection from it, never awaited,
 * would be an unhandled promise rejection (which can crash the process). A sync
 * throw is contained the same way. Deliberately NOT awaited: a failing
 * analytics hook must not fail an otherwise-successful login, and in error
 * paths it must not mask the real error being propagated.
 */
function fireAuthHook(name: string, invoke: (() => void | Promise<void>) | undefined) {
  try {
    Promise.resolve(invoke?.()).catch((hookError: unknown) => {
      console.error(`Error in ${name} hook:`, hookError);
    });
  } catch (hookError) {
    console.error(`Error in ${name} hook:`, hookError);
  }
}

function isMagicLinkEnabled(): boolean {
  return Boolean(getAuthConfig().magicLink?.enabled);
}

function isMagicLinkSignupEnabled(): boolean {
  return Boolean(getAuthConfig().magicLink?.allowSignup);
}

/**
 * Looks up a magic link token without consuming it. Only matches the hashed
 * form: tokens are stored as `hashToken(rawToken)`, and the caller must present
 * the raw token. There is deliberately no plaintext fallback — matching the raw
 * value against the stored column would let a leaked SHA-256 digest be replayed
 * as a bearer token, defeating the point of hashing at rest.
 */
async function findMagicLinkTokenDoc(rawToken: string) {
  return magicLinkTokensCollection.findOne({ token: hashToken(rawToken) });
}

/**
 * Atomically claims a magic link token by `_id` — the single-use enforcement
 * point. Of concurrent requests holding the same token, exactly one gets the
 * doc back; the rest get null. Returns the deleted doc, or null if already claimed.
 */
async function claimMagicLinkTokenById(id: ObjectId) {
  return magicLinkTokensCollection.findOneAndDelete({ _id: id });
}

/**
 * Best-effort undo of a token claim: re-inserts the exact claimed doc (same
 * `_id`, hashes, and expiry) so the single-use link/code works again on retry.
 * Used when the work the claim was committing to (the signup pre-gate or the
 * account insert) failed without producing an account — otherwise the failure would permanently burn
 * the user's link. Never throws: the caller is already propagating the real
 * error, and a failed restore must not mask it.
 */
async function restoreClaimedMagicLinkToken(
  claimedToken: NonNullable<Awaited<ReturnType<typeof claimMagicLinkTokenById>>>
) {
  try {
    await magicLinkTokensCollection.insertOne(claimedToken);
  } catch (restoreError) {
    console.error('Failed to restore a magic link token after a failed signup:', restoreError);
  }
}

// The same generic response is returned whether or not an account exists for
// the email, to prevent user enumeration.
const magicLinkSent = {
  success: true,
  message: 'If this email can be used to sign in, a link has been sent',
};

export async function handleSendMagicLink(args: Args, { connectionInfo }: Context) {
  if (!isMagicLinkEnabled()) {
    throw new Error('Magic link authentication is not enabled');
  }

  const email = validateEmail(args.email as string);
  const ip = connectionInfo?.ip;

  if (ip) {
    await consumeRateLimit({
      bucket: 'magicLink',
      type: 'ip',
      value: ip,
    });
  }

  await consumeRateLimit({
    bucket: 'magicLink',
    type: 'email',
    value: email,
  });

  // Checked up front (unlike password reset): with `allowSignup` on, unknown
  // emails also get a real email, so there is no guaranteed early-out path
  // that could otherwise skip this.
  const emailProvider = getEmailConfig().provider;
  if (!emailProvider) {
    throw new Error('Email provider is not configured');
  }

  // Same preflight reasoning: no fallback sender. A default like
  // `noreply@modelence.com` would send customer auth email from our domain —
  // and fail SPF/DKIM on their provider anyway — so fail loudly instead.
  const fromAddress = getEmailConfig().from;
  if (!fromAddress) {
    throw new Error('Email `from` address is not configured');
  }

  // Also a preflight: resolved before the token is stored, so a misconfigured
  // server fails loudly without leaving behind an orphaned (unsendable) token.
  // Config ONLY — no fallback to the request's Host-derived base URL: the
  // emailed link IS the credential, and a request-derived base would let a
  // spoofed Host header poison the link's destination (login-link poisoning).
  const baseUrl = getConfig('_system.site.url') as string | undefined;
  if (!baseUrl) {
    throw new Error('Unable to build magic link: set _system.site.url (MODELENCE_SITE_URL)');
  }

  // Runs identically for known and unknown emails, so the thrown error reveals
  // only a property of the email domain, never account existence.
  if (!getAuthConfig().allowDisposableEmails && (await isDisposableEmail(email))) {
    throw new Error('Please use a permanent email address');
  }

  const userDoc = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (userDoc && (userDoc.status === 'disabled' || userDoc.status === 'deleted')) {
    // For security, don't reveal the account state — skip the email silently.
    return magicLinkSent;
  }

  if (!userDoc && !isMagicLinkSignupEnabled()) {
    // Signup is not allowed, so a link for an unknown email could never be
    // used — skip it silently (same generic response) so account existence
    // is not revealed.
    return magicLinkSent;
  }

  // Generate the two credentials backed by the same doc: a long token for the
  // clickable link and a short code the user can type (e.g. on mobile, or when
  // reading the email on a different device).
  const magicLinkToken = randomBytes(32).toString('hex');
  const oneTimeCode = randomInt(0, 10 ** ONE_TIME_CODE_LENGTH)
    .toString()
    .padStart(ONE_TIME_CODE_LENGTH, '0');
  const now = Date.now();
  const createdAt = new Date(now);
  const expiresAt = new Date(now + time.minutes(MAGIC_LINK_EXPIRY_MINUTES));

  // Store only the hashes, never the raw values (defense against db leaks;
  // for the short code the attempt cap and expiry are the primary defense,
  // since its keyspace is small enough to brute-force a leaked hash offline).
  await magicLinkTokensCollection.insertOne({
    email,
    token: hashToken(magicLinkToken),
    code: hashToken(oneTimeCode),
    attempts: 0,
    createdAt,
    expiresAt,
  });

  // Point the email at the server landing route, not the SPA page, so the raw
  // token never reaches a client-rendered URL.
  const magicLinkUrl = `${baseUrl}/api/_internal/auth/magic-link?token=${magicLinkToken}`;

  // Send email
  const template = getEmailConfig()?.magicLink?.template || magicLinkTemplate;
  const htmlTemplate = template({ email, magicLinkUrl, code: oneTimeCode, name: '' });
  const textContent = htmlToText(htmlTemplate);

  await emailProvider.sendEmail({
    to: email,
    from: fromAddress,
    subject: getEmailConfig()?.magicLink?.subject || 'Your sign-in link',
    text: textContent,
    html: htmlTemplate,
  });

  return magicLinkSent;
}

/**
 * Server landing route for magic link sign-in. The email links here instead of
 * the SPA page: we validate the token, stash it in a short-lived httpOnly
 * cookie, and 302-redirect to the tokenless SPA page — so the token never
 * reaches client JS. The token is deliberately NOT consumed here: email
 * security scanners prefetch GET links, and consuming on GET would burn the
 * single-use token before the user ever clicks it. Consumption happens in the
 * `loginWithMagicLink` mutation triggered by the user's browser.
 */
export async function handleMagicLinkLanding(params: RouteParams): Promise<RouteResponse> {
  // Config ONLY — no fallback to the request's Host header, which is
  // attacker-controlled and must never decide where an auth flow redirects.
  // A link can only have been emailed with `_system.site.url` set, so this is
  // normally present; if it was unset since, fall back to a same-origin
  // relative redirect rather than trusting the request.
  const baseUrl = (getConfig('_system.site.url') as string | undefined) || '';
  const magicLinkPageUrl = resolveUrl(baseUrl, getEmailConfig().magicLink?.redirectUrl) || '/';

  try {
    const token = z.string().parse(params.query.token);

    const tokenDoc = await findMagicLinkTokenDoc(token);
    if (!tokenDoc || tokenDoc.expiresAt < new Date()) {
      throw new Error('This sign-in link is invalid or has expired.');
    }

    params.res.cookie(MAGIC_LINK_COOKIE, token, {
      ...MAGIC_LINK_COOKIE_OPTIONS,
      maxAge: time.minutes(MAGIC_LINK_EXPIRY_MINUTES),
    });

    return {
      status: 302,
      // Suppress the Referer so the token-bearing landing URL never leaks.
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: magicLinkPageUrl,
    };
  } catch (error) {
    // Surface a fixed, friendly message; never forward the raw error (ZodError or
    // DB error) into the redirect URL. Log the real cause server-side instead.
    console.error('Error handling magic link landing:', error);
    const message = 'This sign-in link is invalid or has expired.';
    return {
      status: 302,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: `${magicLinkPageUrl}?status=error&message=${encodeURIComponent(message)}`,
    };
  }
}

type MagicLinkAuthParams = {
  tokenDoc: { _id: ObjectId; email: string };
  session: Session;
  connectionInfo: ConnectionInfo;
  res: Context['res'];
  clearCookie: () => void;
};

// A magic link / one-time code proves ownership of the email, so authentication
// is a find-or-create: an existing account logs in, an unknown email signs up
// (when enabled). Mongo does both in one atomic upsert, so there is no
// claim→insert→catch-duplicate→recover saga to compensate — see the retry note
// on the E11000 branch for the one race the atomic op can't rule out by itself.

const USER_COLLATION = { locale: 'en', strength: 2 } as const;

/**
 * The account-touching core of both entrypoints, given an already-validated
 * token doc. Claims the token (single-use commit point), then find-or-creates
 * the user atomically, verifies the clicked email if it wasn't already, binds
 * the session, and fires the create-path or login-path hooks accordingly.
 */
async function authenticateMagicLinkUser(params: MagicLinkAuthParams) {
  const { tokenDoc, session, connectionInfo, res, clearCookie } = params;
  const email = tokenDoc.email;
  const authConfig = getAuthConfig();
  const signupEnabled = isMagicLinkSignupEnabled();

  // Tracks whether this request is creating a new account, so a failure routes
  // to onSignupError vs onLoginError. Set in the pre-gate below the moment we
  // know the email is unknown (a signup), and kept in sync if the atomic
  // find-or-create later reveals a concurrent account (demoting to a login).
  let isSignupAttempt = false;

  try {
    // Commit point: atomically claim the single-use token. If a concurrent
    // request already consumed it, abort WITHOUT authenticating (no double-spend).
    // Claimed BEFORE the signup pre-gate below so that of concurrent requests
    // holding the same token doc (link + code used together, or a double-submitted
    // login) only the winner runs the signup side effects — a loser aborting here
    // has not re-run onBeforeSignup, burned a signup rate-limit slot, or promoted
    // itself to a signup attempt, so it routes to onLoginError instead of firing
    // onSignupError alongside the winner's onAfterSignup.
    const claimedToken = await claimMagicLinkTokenById(tokenDoc._id);
    if (!claimedToken) {
      clearCookie();
      throw new Error('Invalid or expired magic link');
    }

    // Signup-only side effects run BEFORE the account can exist, preserving
    // onBeforeSignup's veto contract and the pre-insert signup rate limit. The
    // upsert can't tell us "is this a signup?" until after it inserts, so we
    // detect the unknown-email case with a lookup here. A concurrent request
    // may still create the account between this read and the upsert — that race
    // resolves as a login (isNew=false) below, which is the correct outcome.
    let resolvedHandle: string | undefined;
    if (signupEnabled) {
      try {
        const existing = await usersCollection.findOne(
          { 'emails.address': email },
          { collation: USER_COLLATION }
        );
        if (!existing) {
          isSignupAttempt = true;
          await authConfig.onBeforeSignup?.({ email, provider: 'magicLink', connectionInfo });

          const ip = connectionInfo?.ip;
          if (ip) {
            await consumeRateLimit({ bucket: 'signup', type: 'ip', value: ip });
          }

          resolvedHandle = authConfig.generateHandle
            ? await resolveUniqueHandle(await authConfig.generateHandle({ email }), email, {
                throwOnConflict: false,
              })
            : await resolveUniqueHandle(undefined, email);
        }
      } catch (error) {
        // The pre-gate rejected (onBeforeSignup veto, rate limit) or failed
        // transiently — either way no account was created. The token was claimed
        // above; put it back so the failure doesn't permanently burn the link.
        await restoreClaimedMagicLinkToken(claimedToken);
        throw error;
      }
    }

    let upsertResult;
    try {
      upsertResult = await upsertMagicLinkUser(email, resolvedHandle, signupEnabled);
    } catch (error) {
      // The find-or-create failed transiently (e.g. a DB error) without
      // authenticating anyone. The token was claimed above — put it back so a
      // failure that wasn't the link's use doesn't permanently burn it.
      await restoreClaimedMagicLinkToken(claimedToken);
      throw error;
    }
    const { userDoc, isNew } = upsertResult;

    if (!userDoc) {
      // Only reachable with upsert:false, i.e. signup disabled and no account
      // exists (with upsert:true the op always returns a doc). Defense in depth:
      // the send path already refuses unknown emails when signup is off, but a
      // token can outlive its account or the flag can flip between send and
      // click. Nothing was created, so restore the token rather than burning a
      // link on a state the user can't act on. This is a signup attempt the
      // config forbids, so it routes to onSignupError (as the old signup path).
      isSignupAttempt = true;
      await restoreClaimedMagicLinkToken(claimedToken);
      clearCookie();
      throw new Error('Sign up with magic link is not enabled');
    }

    // The upsert is authoritative: a concurrent account means this was a login,
    // not the signup the pre-gate anticipated (demotes onSignupError→onLoginError).
    isSignupAttempt = isNew;

    if (userDoc.status === 'disabled' || userDoc.status === 'deleted') {
      // The link proved email possession but the account cannot be used. Leave
      // the token burned so it can't be retried against a re-enabled account.
      clearCookie();
      throw new Error('User account is not active');
    }

    let currentUserDoc = userDoc;
    // Clicking the emailed link proves ownership. On the insert path the email
    // is already stored verified; on the login path a concurrent password
    // signup may have left it unverified — this link is the proof that verifies
    // it. Skip the redundant write when already verified.
    const emailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === email);
    const wasUnverified = !isNew && !emailDoc?.verified;
    if (wasUnverified) {
      // Same strength-2 collation as the lookups: the stored address may keep
      // its original casing (e.g. OAuth-created accounts) while `email` is
      // lowercased, or the positional update silently matches nothing. Return
      // the updated doc so hooks and the response see `verified: true`.
      const verifiedDoc = await usersCollection.findOneAndUpdate(
        { _id: userDoc._id, 'emails.address': email },
        { $set: { 'emails.$.verified': true } },
        { collation: USER_COLLATION, returnDocument: 'after' }
      );
      currentUserDoc = verifiedDoc ?? userDoc;
    }

    await setSessionUser(session.authToken, currentUserDoc._id);

    if (res) {
      setAuthTokenCookie(res, session.authToken);
    }

    if (isNew) {
      fireAuthHook('onAfterSignup', () =>
        authConfig.onAfterSignup?.({
          provider: 'magicLink',
          user: currentUserDoc,
          session,
          connectionInfo,
        })
      );
    } else {
      if (wasUnverified) {
        fireAuthHook('onAfterEmailVerification', () =>
          authConfig.onAfterEmailVerification?.({
            provider: 'magicLink',
            user: currentUserDoc,
            session,
            connectionInfo,
          })
        );
      }

      fireAuthHook('onAfterLogin', () =>
        authConfig.onAfterLogin?.({
          provider: 'magicLink',
          user: currentUserDoc,
          session,
          connectionInfo,
        })
      );
    }

    clearCookie();

    return {
      user: serializeUserForClient(currentUserDoc),
      session: { authToken: session.authToken },
    };
  } catch (error) {
    // Route the failure to the hook matching what this request was attempting.
    // `isSignupAttempt` is true once the pre-gate sees an unknown email (so a
    // vetoing onBeforeSignup or a signup rate-limit rejection fires
    // onSignupError, matching the old signup path), and stays true only if the
    // account was actually created — the unknown→login race demotes it.
    if (error instanceof Error) {
      const hookName = isSignupAttempt ? 'onSignupError' : 'onLoginError';
      const hook = isSignupAttempt ? authConfig.onSignupError : authConfig.onLoginError;
      fireAuthHook(hookName, () =>
        hook?.({ provider: 'magicLink', error, session, connectionInfo })
      );
    }
    throw error;
  }
}

/**
 * Atomic find-or-create for the magic-link user. Returns the user (post-op)
 * and whether this call created it. `upsert` is gated on `signupEnabled`: when
 * signup is off this is a pure find (unknown email → `{ userDoc: null }`), so
 * no account is ever created for an email that could never sign up — no
 * insert-then-delete compensation.
 *
 * The `$elemMatch` selector (rather than `'emails.address'`) avoids the upsert
 * field-path conflict with `$setOnInsert: { emails: [...] }`. Concurrent upserts
 * can still race to insert the same email (a known Mongo caveat the unique
 * index turns into an E11000); a single retry re-runs the op, which now finds
 * the winner's doc and returns it as a login (`isNew: false`).
 */
async function upsertMagicLinkUser(
  email: string,
  resolvedHandle: string | undefined,
  signupEnabled: boolean
): Promise<{ userDoc: User | null; isNew: boolean }> {
  const runUpsert = () =>
    usersCollection.findOneAndUpsert(
      { emails: { $elemMatch: { address: email } } },
      {
        $setOnInsert: {
          handle: resolvedHandle as string,
          status: 'active',
          // Clicking the emailed link proves ownership of the address.
          emails: [{ address: email, verified: true }],
          createdAt: new Date(),
          // Magic link is proof of email possession — there is no per-user
          // credential to store, so no authMethods entry is added.
          authMethods: {},
        },
      },
      { upsert: signupEnabled, collation: USER_COLLATION }
    );

  try {
    const { doc, isNew } = await runUpsert();
    return { userDoc: doc as User | null, isNew };
  } catch (error) {
    if (!isDuplicateEmailError(error)) {
      throw error;
    }
    // Concurrent insert won the race; re-run to read the winner's doc. This can
    // only resolve as a match now (the account exists), so isNew is false.
    const { doc } = await runUpsert();
    return { userDoc: doc as User | null, isNew: false };
  }
}

/**
 * Consumes the magic link token stashed in the httpOnly cookie by the landing
 * route, logging in the matching user — or, when `magicLink.allowSignup` is
 * enabled, creating the account first when the email is unknown (combined
 * sign-in/sign-up, like OAuth).
 */
export async function handleLoginWithMagicLink(args: Args, context: Context) {
  const { session, connectionInfo, res, req } = context;

  if (!session) {
    throw new Error('Session is not initialized');
  }

  if (!isMagicLinkEnabled()) {
    throw new Error('Magic link authentication is not enabled');
  }

  // The token travels only in the httpOnly cookie set by the landing route —
  // there is deliberately no args fallback (new API, no legacy clients).
  const token = z.string().parse(req?.cookies?.[MAGIC_LINK_COOKIE]);

  const clearCookie = () => {
    // `res` is null for in-process invocations (no response to mutate).
    // Clear with the same flags used to set it; browsers ignore a clear whose
    // attributes don't match, which would leave the httpOnly cookie behind.
    res?.clearCookie(MAGIC_LINK_COOKIE, MAGIC_LINK_COOKIE_OPTIONS);
  };

  // Look up WITHOUT consuming: if a later step fails transiently, the link
  // stays valid so the user can retry it.
  const tokenDoc = await findMagicLinkTokenDoc(token);
  if (!tokenDoc) {
    clearCookie();
    throw new Error('Invalid or expired magic link');
  }

  if (tokenDoc.expiresAt < new Date()) {
    // Expired: remove it and reject.
    await claimMagicLinkTokenById(tokenDoc._id as ObjectId);
    clearCookie();
    throw new Error('Magic link has expired');
  }

  return authenticateMagicLinkUser({
    tokenDoc: { _id: tokenDoc._id as ObjectId, email: tokenDoc.email },
    session,
    connectionInfo,
    res,
    clearCookie,
  });
}

/**
 * Consumes the one-time code from the magic link email, logging in the
 * matching user — or, when `magicLink.allowSignup` is enabled, creating the
 * account first when the email is unknown. Same semantics as the link: the
 * code proves possession of the address.
 *
 * The typed-code path exists for contexts where the link chain breaks: native
 * apps without deep links set up, or reading the email on a different device
 * than the one signing in.
 */
export async function handleLoginWithOneTimeCode(args: Args, context: Context) {
  const { session, connectionInfo, res } = context;

  if (!session) {
    throw new Error('Session is not initialized');
  }

  if (!isMagicLinkEnabled()) {
    throw new Error('Magic link authentication is not enabled');
  }

  const email = validateEmail(args.email as string);
  // Tolerate the formatting users copy from the email ("482 193", "482-193").
  const code = z.string().parse(args.code).replace(/[\s-]/g, '');

  const ip = connectionInfo?.ip;
  if (ip) {
    await consumeRateLimit({
      bucket: 'oneTimeCode',
      type: 'ip',
      value: ip,
    });
  }

  await consumeRateLimit({
    bucket: 'oneTimeCode',
    type: 'email',
    value: email,
  });

  // Look up WITHOUT consuming, keyed by email + hashed code. Docs that already
  // burned their guess allowance are excluded, so a capped code can never be
  // used even if eventually guessed right.
  const tokenDoc = await magicLinkTokensCollection.findOne({
    email,
    code: hashToken(code),
    attempts: { $lt: MAX_CODE_ATTEMPTS },
  });

  if (!tokenDoc) {
    // Count the failed guess against every outstanding code for this email —
    // attempts are tracked on the docs themselves so concurrent guesses are
    // counted atomically.
    await magicLinkTokensCollection.updateMany({ email }, { $inc: { attempts: 1 } });
    // Same message whether the code is wrong, capped, or the email unknown —
    // never reveal account existence.
    throw new Error('Invalid or expired code');
  }

  if (tokenDoc.expiresAt < new Date()) {
    // Expired: remove it and reject.
    await claimMagicLinkTokenById(tokenDoc._id as ObjectId);
    throw new Error('Code has expired');
  }

  return authenticateMagicLinkUser({
    tokenDoc: { _id: tokenDoc._id as ObjectId, email: tokenDoc.email },
    session,
    connectionInfo,
    res,
    // The code travels as a mutation argument — there is no cookie to clear.
    clearCookie: () => {},
  });
}
