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

  // Also a preflight: resolved before the token is stored, so a misconfigured
  // server fails loudly without leaving behind an orphaned (unsendable) token.
  // Without a base URL we'd email a broken `undefined/...` link.
  const baseUrl = (getConfig('_system.site.url') as string | undefined) || connectionInfo?.baseUrl;
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
    from: getEmailConfig()?.from || 'noreply@modelence.com',
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
  const baseUrl =
    (getConfig('_system.site.url') as string | undefined) ||
    `${params.req.protocol}://${params.req.get('host')}`;
  const magicLinkPageUrl = resolveUrl(baseUrl, getEmailConfig().magicLink?.redirectUrl);

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

/**
 * Runs the login side effects for an already-resolved, already-token-claimed
 * user: marks the clicked email verified, binds the session, and fires the
 * verification/login hooks. Deliberately does NOT claim the token — callers own
 * that commit point — so it can be reused both by the normal login branch and
 * by the signup path's duplicate-recovery (where the token was already claimed).
 */
async function completeLoginForUser(userDoc: User, params: MagicLinkAuthParams) {
  const { tokenDoc, session, connectionInfo, res, clearCookie } = params;
  const authConfig = getAuthConfig();

  // Clicking the emailed link proves ownership of the address. A concurrent
  // password signup may have created the account as unverified — this link is
  // the proof that verifies it.
  const emailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === tokenDoc.email);
  const wasUnverified = !emailDoc?.verified;
  await usersCollection.updateOne(
    { _id: userDoc._id, 'emails.address': tokenDoc.email },
    { $set: { 'emails.$.verified': true } }
  );

  await setSessionUser(session.authToken, userDoc._id);

  if (res) {
    setAuthTokenCookie(res, session.authToken);
  }

  if (wasUnverified) {
    authConfig.onAfterEmailVerification?.({
      provider: 'magicLink',
      user: userDoc,
      session,
      connectionInfo,
    });
  }

  authConfig.onAfterLogin?.({
    provider: 'magicLink',
    user: userDoc,
    session,
    connectionInfo,
  });

  clearCookie();

  return {
    user: serializeUserForClient(userDoc),
    session: { authToken: session.authToken },
  };
}

async function loginExistingUser(userDoc: User, params: MagicLinkAuthParams) {
  const { tokenDoc, session, connectionInfo, clearCookie } = params;
  const authConfig = getAuthConfig();

  try {
    if (userDoc.status === 'disabled' || userDoc.status === 'deleted') {
      // The link proved email possession but the account cannot be used — burn
      // the token so it can't be retried against a re-enabled account.
      await claimMagicLinkTokenById(tokenDoc._id);
      clearCookie();
      throw new Error('User account is not active');
    }

    // Commit point: atomically claim the token. If a concurrent request already
    // consumed it, abort WITHOUT logging in (single-use, no double-spend).
    const claimedToken = await claimMagicLinkTokenById(tokenDoc._id);
    if (!claimedToken) {
      clearCookie();
      throw new Error('Invalid or expired magic link');
    }

    return await completeLoginForUser(userDoc, params);
  } catch (error) {
    if (error instanceof Error) {
      authConfig.onLoginError?.({
        provider: 'magicLink',
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }
}

async function signupNewUser(params: MagicLinkAuthParams) {
  const { tokenDoc, session, connectionInfo, res, clearCookie } = params;
  const email = tokenDoc.email;
  const authConfig = getAuthConfig();

  try {
    // Defense in depth: the send path already refuses unknown emails when
    // signup is off, but a token can outlive its account (e.g. the account is
    // deleted after the email was sent) or the flag can be toggled off between
    // send and click — never auto-create an account without the opt-in.
    if (!isMagicLinkSignupEnabled()) {
      clearCookie();
      throw new Error('Sign up with magic link is not enabled');
    }

    await authConfig.onBeforeSignup?.({
      email,
      provider: 'magicLink',
      connectionInfo,
    });

    const ip = connectionInfo?.ip;
    if (ip) {
      await consumeRateLimit({
        bucket: 'signup',
        type: 'ip',
        value: ip,
      });
    }

    // Resolve unique handle
    let resolvedHandle: string;

    if (authConfig.generateHandle) {
      const generated = await authConfig.generateHandle({ email });

      resolvedHandle = await resolveUniqueHandle(generated, email, {
        throwOnConflict: false,
      });
    } else {
      resolvedHandle = await resolveUniqueHandle(undefined, email);
    }

    // Commit point: claim the token BEFORE the insert so a double-submitted
    // mutation cannot create two accounts from the same link.
    const claimedToken = await claimMagicLinkTokenById(tokenDoc._id);
    if (!claimedToken) {
      clearCookie();
      throw new Error('Invalid or expired magic link');
    }

    let insertResult;
    try {
      insertResult = await usersCollection.insertOne({
        handle: resolvedHandle,
        status: 'active',
        emails: [
          {
            address: email,
            // Clicking the emailed link proves ownership of the address.
            verified: true,
          },
        ],
        createdAt: new Date(),
        // Magic link is proof of email possession — there is no per-user
        // credential to store, so no authMethods entry is added.
        authMethods: {},
      });
    } catch (error) {
      if (!isDuplicateEmailError(error)) {
        throw error;
      }
      // A concurrent request (another link, the code path, or password signup)
      // won the race and created this email's account first. The unique index
      // rejected our insert, so this is no longer a signup — it's a login into
      // the account that now exists. This request already legitimately claimed
      // its own token above, proving email ownership, so recover by running the
      // LOGIN path (verify the email, fire onAfterLogin/onAfterEmailVerification)
      // rather than the signup tail — otherwise we would double-fire
      // onAfterSignup and leave a password-created account unverified.
      const existingUser = await usersCollection.findOne(
        { 'emails.address': email },
        { collation: { locale: 'en', strength: 2 }, readPreference: 'primary' }
      );

      if (!existingUser) {
        throw new Error('User not found');
      }

      if (existingUser.status === 'disabled' || existingUser.status === 'deleted') {
        clearCookie();
        throw new Error('User account is not active');
      }

      return await completeLoginForUser(existingUser, params);
    }

    const userDocument = await usersCollection.findOne(
      { _id: insertResult.insertedId },
      { readPreference: 'primary' }
    );

    if (!userDocument) {
      throw new Error('User not found');
    }

    await setSessionUser(session.authToken, userDocument._id);

    if (res) {
      setAuthTokenCookie(res, session.authToken);
    }

    authConfig.onAfterSignup?.({
      provider: 'magicLink',
      user: userDocument,
      session,
      connectionInfo,
    });

    clearCookie();

    return {
      user: serializeUserForClient(userDocument),
      session: { authToken: session.authToken },
    };
  } catch (error) {
    if (error instanceof Error) {
      authConfig.onSignupError?.({
        provider: 'magicLink',
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
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

  const userDoc = await usersCollection.findOne(
    { 'emails.address': tokenDoc.email },
    { collation: { locale: 'en', strength: 2 } }
  );

  const authParams: MagicLinkAuthParams = {
    tokenDoc: { _id: tokenDoc._id as ObjectId, email: tokenDoc.email },
    session,
    connectionInfo,
    res,
    clearCookie,
  };

  if (userDoc) {
    return loginExistingUser(userDoc, authParams);
  }

  return signupNewUser(authParams);
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

  const userDoc = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  const authParams: MagicLinkAuthParams = {
    tokenDoc: { _id: tokenDoc._id as ObjectId, email: tokenDoc.email },
    session,
    connectionInfo,
    res,
    // The code travels as a mutation argument — there is no cookie to clear.
    clearCookie: () => {},
  };

  if (userDoc) {
    return loginExistingUser(userDoc, authParams);
  }

  return signupNewUser(authParams);
}
