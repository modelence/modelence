import { randomBytes } from 'crypto';
import { type Request, type Response } from 'express';
import { MongoServerError, ObjectId } from 'mongodb';
import { usersCollection } from '@/auth/db';
import {
  createSession,
  setAuthTokenCookie,
  consumeLinkNonce,
  issueOAuthExchangeCode,
} from '@/auth/session';
import { getAuthConfig } from '@/app/authConfig';
import { getCallContext } from '@/app/server';
import { getConfig } from '@/config/server';
import { time } from '@/time';
import { resolveUniqueHandle } from '../utils';
import { User, Session, UserEmail, OAuthProvider } from '@/auth/types';
import { ConnectionInfo } from '@/methods/types';
import {
  isAllowedMobileRedirectUrl,
  buildMobileRedirect,
  getAllowedMobileRedirectUrls,
} from './mobileRedirect';
import { buildOAuthErrorRedirect } from './oauthErrorRedirect';

/** Which kind of client started an OAuth flow. */
export type OAuthPlatform = 'web' | 'mobile';

/**
 * How a completed OAuth flow is handed back to the client.
 *
 * Web sets the session cookie and redirects to the site root, as it always has.
 * Mobile has no shared cookie jar, so it redirects to the app's deep link with a
 * single-use exchange code the app redeems for a session (see
 * `issueOAuthExchangeCode`).
 */
export type OAuthOutcome =
  | { platform: 'web' }
  | {
      platform: 'mobile';
      redirectUri: string;
      /**
       * PKCE-style challenge from the device that started the flow.
       *
       * Present for a sign-in, where it binds the exchange code to that device.
       * Absent for linking, which redirects with `linked=<provider>` and mints
       * no credential — so there is nothing to bind. `authenticateUser` is the
       * only caller that mints a code, and it requires
       * {@link BoundMobileOutcome}, so an unbound value cannot reach it.
       */
      codeChallenge?: string;
    };

/**
 * A mobile outcome that is allowed to mint an exchange code.
 *
 * Narrower than {@link OAuthOutcome}: `codeChallenge` is required, so the
 * compiler — not a runtime check — rejects any attempt to mint a code for a
 * flow that carries no device binding.
 */
export type BoundMobileOutcome = {
  platform: 'mobile';
  redirectUri: string;
  codeChallenge: string;
};

/**
 * Where an *error* should be delivered.
 *
 * A failure carries no credential, so it needs a destination but no binding.
 */
export type OAuthErrorTarget = { platform: 'web' } | { platform: 'mobile'; redirectUri: string };

/**
 * Resolves the outcome for a validated OAuth state.
 *
 * A mobile state stays mobile whether or not it carries a challenge: dropping to
 * web here would strand a native client in the device browser at `/` instead of
 * deep-linking back. Whether a code may be minted is decided at the point of
 * minting, by {@link isBoundMobileOutcome}.
 */
export function toOAuthOutcome(
  state: Pick<OAuthStateResult, 'platform' | 'redirectUri' | 'codeChallenge'>
): OAuthOutcome {
  if (state.platform === 'mobile' && state.redirectUri) {
    return {
      platform: 'mobile',
      redirectUri: state.redirectUri,
      ...(state.codeChallenge ? { codeChallenge: state.codeChallenge } : {}),
    };
  }
  return { platform: 'web' };
}

/** Whether a mobile outcome carries the binding required to mint a code. */
export function isBoundMobileOutcome(outcome: OAuthOutcome): outcome is BoundMobileOutcome {
  return outcome.platform === 'mobile' && typeof outcome.codeChallenge === 'string';
}

/**
 * Whether the callback should fire the *login* hooks itself.
 *
 * On mobile it must not: this runs in the device browser against a throwaway
 * guest session, and the sign-in is only real once the app redeems the code.
 * `handleLoginWithOAuth` fires them there with the user's real session. Firing
 * in both places delivered every login hook twice, the first time with the
 * wrong session.
 *
 * Signup hooks are deliberately not gated: account creation genuinely happens
 * here, fires once, and redemption cannot tell a new account from a returning
 * one.
 */
function shouldFireLoginHooks(outcome: OAuthOutcome): boolean {
  return outcome.platform !== 'mobile';
}

export interface OAuthUserData {
  id: string;
  email: string;
  emailVerified: boolean;
  providerName: OAuthProvider;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}
/** Consumes a single-use link nonce; returns the bound userId string or null. */
export async function resolveUserIdFromLinkNonce(
  nonce: string | undefined
): Promise<string | null> {
  if (!nonce || typeof nonce !== 'string') return null;
  return consumeLinkNonce(nonce);
}

/**
 * Machine-readable failure reasons handed to a native app alongside the
 * human-readable message, so the app can branch on the outcome without parsing
 * English prose.
 */
export type OAuthErrorCode =
  | 'missing_code'
  | 'invalid_state'
  | 'invalid_redirect'
  | 'invalid_link_nonce'
  | 'account_inactive'
  | 'email_exists'
  | 'email_required'
  | 'link_failed'
  | 'not_signed_in'
  | 'oauth_failed';

/*
 * Sends OAuth error response.
 * If `oauthErrorRedirectUrl` is configured, redirects there with the failure
 * in the query string. Otherwise, if `errorComponent` is configured, renders
 * HTML. Otherwise falls back to JSON.
 *
 * On a mobile flow, an HTML or JSON body would strand the user in the device
 * browser with no route back into the app, so the error is delivered as a
 * redirect to the app's deep link instead. Errors raised before the state is
 * decoded have no known platform and keep the default behaviour.
 */
export function sendOAuthError(
  res: Response,
  statusCode: number,
  errorMessage: string,
  // Only a destination is needed to report a failure; an OAuthOutcome is
  // accepted too, since it is a strict subtype.
  outcome: OAuthErrorTarget = { platform: 'web' },
  errorCode: OAuthErrorCode = 'oauth_failed'
) {
  if (outcome.platform === 'mobile') {
    // The human-readable message is for display; `errorCode` is what an app
    // should branch on, since the message text is not a stable contract.
    res.set('Referrer-Policy', 'no-referrer');
    return res.redirect(
      buildMobileRedirect(outcome.redirectUri, { error: errorMessage, errorCode })
    );
  }

  const authConfig = getAuthConfig();

  if (authConfig.oauthErrorRedirectUrl) {
    // Same shape as the mobile deep link, so a client can handle both alike.
    // The message is not a credential, but it is user-facing text about a
    // failed sign-in; keep it out of Referer like the mobile branch does.
    res.set('Referrer-Policy', 'no-referrer');
    return res.redirect(
      buildOAuthErrorRedirect(authConfig.oauthErrorRedirectUrl, { error: errorMessage, errorCode })
    );
  }

  const response = res.status(statusCode);
  if (authConfig.errorComponent) {
    try {
      const html = authConfig.errorComponent({ error: errorMessage, statusCode });
      if (html) return response.send(html);
    } catch (err) {
      console.error('Unhandled error in authConfig.errorComponent:', err);
    }
  }

  return response.json({ error: errorMessage });
}

export async function authenticateUser(
  res: Response,
  userId: ObjectId,
  provider: OAuthProvider,
  outcome: OAuthOutcome = { platform: 'web' }
) {
  if (outcome.platform === 'mobile') {
    // Fail closed rather than falling through to a cookie session: a mobile
    // sign-in always carries a challenge (initiation rejects it otherwise), so
    // reaching here without one means the state was tampered with or truncated.
    // Silently issuing a browser session instead would strand the app at `/`.
    if (!isBoundMobileOutcome(outcome)) {
      sendOAuthError(
        res,
        400,
        'This sign-in could not be completed. Please try signing in again.',
        outcome,
        'invalid_state'
      );
      return;
    }

    // Deliberately no session and no cookie: the deep link is the weakest hop (a
    // custom scheme can be claimed by any installed app), so it carries only a
    // single-use code. The session is minted at redemption over TLS, so an
    // intercepted-but-unredeemed code never corresponds to a live session.
    const code = await issueOAuthExchangeCode(userId.toString(), provider, outcome.codeChallenge);

    // The deep link carries a credential; keep it out of any Referer header.
    res.set('Referrer-Policy', 'no-referrer');
    res.redirect(buildMobileRedirect(outcome.redirectUri, { code }));
    return;
  }

  const { authToken } = await createSession(userId);

  setAuthTokenCookie(res, authToken);
  res.redirect('/');
}

async function handleExistingProviderLogin(
  res: Response,
  userData: OAuthUserData,
  existingUser: User,
  session: Session | null,
  connectionInfo: ConnectionInfo,
  outcome: OAuthOutcome
) {
  const authConfig = getAuthConfig();

  try {
    if (existingUser.status === 'disabled' || existingUser.status === 'deleted') {
      sendOAuthError(res, 400, 'User account is not active.', outcome);
      return;
    }

    //Add User FirstName,LastName, AvatarURL if not exists
    const update: Partial<Pick<OAuthUserData, 'firstName' | 'lastName' | 'avatarUrl'>> = {};

    if (existingUser.firstName === undefined && userData.firstName) {
      update.firstName = userData.firstName;
    }
    if (existingUser.lastName === undefined && userData.lastName) {
      update.lastName = userData.lastName;
    }
    if (existingUser.avatarUrl === undefined && userData.avatarUrl) {
      update.avatarUrl = userData.avatarUrl;
    }

    let user = existingUser;

    if (Object.keys(update).length > 0) {
      await usersCollection.updateOne({ _id: existingUser._id }, { $set: update });
      user = { ...existingUser, ...update } as typeof existingUser;
    }

    await authenticateUser(res, existingUser._id, userData.providerName, outcome);

    if (shouldFireLoginHooks(outcome)) {
      authConfig.onAfterLogin?.({
        provider: userData.providerName,
        user,
        session,
        connectionInfo,
      });
      authConfig.login?.onSuccess?.(user);
    }
  } catch (error) {
    if (error instanceof Error) {
      authConfig.login?.onError?.(error);

      authConfig.onLoginError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }
}

async function handleExistingEmailLogin(
  res: Response,
  userData: OAuthUserData,
  existingUserByEmail: User,
  session: Session | null,
  connectionInfo: ConnectionInfo,
  outcome: OAuthOutcome
) {
  const authConfig = getAuthConfig();
  const linkingMode = authConfig.oauthAccountLinking ?? 'manual';

  if (linkingMode === 'auto' && userData.emailVerified) {
    if (existingUserByEmail.status === 'disabled' || existingUserByEmail.status === 'deleted') {
      sendOAuthError(res, 400, 'User account is not active.', outcome);
      return;
    }

    const matchedEmail = existingUserByEmail.emails?.find(
      (emailDoc: UserEmail) => emailDoc.address.toLowerCase() === userData.email.toLowerCase()
    );

    // Prevent pre-registration takeover by requiring local ownership verification too.
    if (!matchedEmail?.verified) {
      sendOAuthError(
        res,
        400,
        'User with this email already exists. Please log in instead.',
        outcome
      );
      return;
    }

    try {
      // Build profile fields to backfill from provider data if missing
      const profileUpdate: Partial<Pick<OAuthUserData, 'firstName' | 'lastName' | 'avatarUrl'>> = {
        ...(existingUserByEmail.firstName === undefined &&
          userData.firstName && { firstName: userData.firstName }),
        ...(existingUserByEmail.lastName === undefined &&
          userData.lastName && { lastName: userData.lastName }),
        ...(existingUserByEmail.avatarUrl === undefined &&
          userData.avatarUrl && { avatarUrl: userData.avatarUrl }),
      };

      // Single atomic update — link provider + backfill profile in one round trip
      const updateResult = await usersCollection.updateOne(
        {
          _id: existingUserByEmail._id,
          status: { $nin: ['deleted', 'disabled'] },
          $or: [
            { [`authMethods.${userData.providerName}.id`]: { $exists: false } },
            { [`authMethods.${userData.providerName}.id`]: userData.id },
          ],
        },
        {
          $set: {
            [`authMethods.${userData.providerName}.id`]: userData.id,
            ...profileUpdate,
          },
        }
      );

      const autoLinkSuccessful = updateResult.matchedCount > 0;

      if (!autoLinkSuccessful) {
        // User was deleted/disabled between findOne and updateOne, or linked to a *different* ID
        sendOAuthError(
          res,
          400,
          'User with this email already exists. Please log in instead.',
          outcome
        );
        return;
      }

      await authenticateUser(res, existingUserByEmail._id, userData.providerName, outcome);

      // Construct updated user in-memory to provide fresh data to callbacks
      const updatedUser: User = {
        ...existingUserByEmail,
        ...profileUpdate,
        authMethods: {
          ...existingUserByEmail.authMethods,
          [userData.providerName]: {
            id: userData.id,
          },
        },
      };

      if (shouldFireLoginHooks(outcome)) {
        authConfig.onAfterLogin?.({
          provider: userData.providerName,
          user: updatedUser,
          session,
          connectionInfo,
        });
        authConfig.login?.onSuccess?.(updatedUser);
      }

      return;
    } catch (error) {
      if (error instanceof Error) {
        authConfig.login?.onError?.(error);

        authConfig.onLoginError?.({
          provider: userData.providerName,
          error,
          session,
          connectionInfo,
        });
      }
      throw error;
    }
  }

  // Manual mode (default) or unverified email — reject
  sendOAuthError(res, 400, 'User with this email already exists. Please log in instead.', outcome);
  return;
}

async function handleNewUserSignup(
  res: Response,
  userData: OAuthUserData,
  session: Session | null,
  connectionInfo: ConnectionInfo,
  outcome: OAuthOutcome
) {
  const authConfig = getAuthConfig();

  try {
    let handle: string;

    if (authConfig.generateHandle) {
      const generated = await authConfig.generateHandle!({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
      });
      //Don't throw error if handle is already taken, instead add a suffix '_2', '_3', etc. to the handle
      handle = await resolveUniqueHandle(generated, userData.email, {
        throwOnConflict: false,
      });
    } else {
      handle = await resolveUniqueHandle(undefined, userData.email);
    }

    const userDoc = {
      handle: handle,
      status: 'active' as const,
      emails: [
        {
          address: userData.email,
          verified: userData.emailVerified,
        },
      ],
      createdAt: new Date(),
      authMethods: {
        [userData.providerName]: {
          id: userData.id,
        },
      },
      ...(userData.firstName !== undefined && { firstName: userData.firstName }),
      ...(userData.lastName !== undefined && { lastName: userData.lastName }),
      ...(userData.avatarUrl !== undefined && { avatarUrl: userData.avatarUrl }),
    };

    const newUser = await usersCollection.insertOne(userDoc);

    await authenticateUser(res, newUser.insertedId, userData.providerName, outcome);

    const userDocument = await usersCollection.findOne(
      { _id: newUser.insertedId },
      { readPreference: 'primary' }
    );

    if (userDocument) {
      authConfig.onAfterSignup?.({
        provider: userData.providerName,
        user: userDocument,
        session,
        connectionInfo,
      });

      authConfig.signup?.onSuccess?.(userDocument);
    }
  } catch (error) {
    if (error instanceof Error) {
      authConfig.onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      authConfig.signup?.onError?.(error);
    }
    throw error;
  }
}

export function getRedirectUri(provider: string): string {
  return `${getConfig('_system.site.url')}/api/_internal/auth/${provider}/callback`;
}

export async function handleOAuthUserAuthentication(
  req: Request,
  res: Response,
  userData: OAuthUserData,
  outcome: OAuthOutcome = { platform: 'web' }
): Promise<void> {
  // 1. Try to fetch existing user by OAuth ID
  const existingUser = await usersCollection.findOne({
    [`authMethods.${userData.providerName}.id`]: userData.id,
  });

  const { session, connectionInfo } = await getCallContext(req, res);

  if (existingUser) {
    return handleExistingProviderLogin(
      res,
      userData,
      existingUser,
      session,
      connectionInfo,
      outcome
    );
  }

  // 2. Validate Email is provided by Provider
  if (!userData.email) {
    sendOAuthError(
      res,
      400,
      `Email address is required for ${userData.providerName} authentication.`,
      outcome
    );
    return;
  }

  // 3. Try to fetch existing user by Email
  let existingUserByEmail;

  try {
    existingUserByEmail = await usersCollection.findOne(
      { 'emails.address': userData.email, status: { $ne: 'deleted' } },
      { collation: { locale: 'en', strength: 2 } }
    );
  } catch (error) {
    if (error instanceof Error) {
      const authConfig = getAuthConfig();
      authConfig.onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      authConfig.signup?.onError?.(error);
    }
    throw error;
  }

  //User Already existed via email verification but now trying to login via OAuth Providers from the same email
  if (existingUserByEmail) {
    return handleExistingEmailLogin(
      res,
      userData,
      existingUserByEmail,
      session,
      connectionInfo,
      outcome
    );
  }

  //New User
  return handleNewUserSignup(res, userData, session, connectionInfo, outcome);
}

export function clearOAuthLinkCookie(res: Response) {
  // Important: must clear the httpOnly cookie used during OAuth linking
  res.cookie('oauthLinkToken', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/api/_internal/auth/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function safelyCallHook(hook?: () => void) {
  if (!hook) return;

  try {
    hook();
  } catch (err) {
    console.error('Error executing OAuth hook:', err);
  }
}

export interface OAuthStateResult {
  mode: string;
  /** Set only in the React Native linking flow. */
  linkedUserId?: string;
  /** Which client started the flow; decides how the callback hands back the result. */
  platform: OAuthPlatform;
  /** Deep link to return to. Set only when `platform` is 'mobile'. */
  redirectUri?: string;
  /** Device binding for the exchange code. Set only when `platform` is 'mobile'. */
  codeChallenge?: string;
}

/**
 * Builds the value of the per-provider OAuth state cookie.
 *
 * Fields are colon-separated for backwards compatibility with in-flight cookies
 * written before mobile support (`state:mode` and `state:mode:userId` both still
 * parse). `redirectUri` contains colons and slashes of its own, so it is
 * base64url-encoded rather than embedded raw — otherwise a deep link would split
 * into several bogus fields.
 */
export function encodeOAuthState(params: {
  state: string;
  mode: string;
  linkedUserId?: string | null;
  platform?: OAuthPlatform;
  redirectUri?: string | null;
  codeChallenge?: string | null;
}): string {
  const { state, mode, linkedUserId, platform = 'web', redirectUri, codeChallenge } = params;
  const fields = [state, mode, linkedUserId ?? ''];

  // Only extend the cookie when there is something to say — a web flow keeps
  // producing exactly the value it produced before mobile existed.
  if (platform !== 'web' || redirectUri) {
    fields.push(platform);
    fields.push(redirectUri ? Buffer.from(redirectUri, 'utf8').toString('base64url') : '');
    fields.push(codeChallenge ?? '');
  }

  return fields.join(':');
}

function decodeOAuthState(storedState: string): {
  stateValue: string;
  mode: string;
  linkedUserId?: string;
  platform: OAuthPlatform;
  redirectUri?: string;
  codeChallenge?: string;
} {
  const [stateValue, mode, linkedUserId, platform, encodedRedirectUri, codeChallenge] = (
    storedState || ''
  ).split(':');

  // Never throws: invalid base64url decodes to garbage rather than raising, and
  // garbage is rejected by the allowlist check in the caller.
  const redirectUri = encodedRedirectUri
    ? Buffer.from(encodedRedirectUri, 'base64url').toString('utf8') || undefined
    : undefined;

  return {
    stateValue,
    mode: mode || 'login',
    ...(linkedUserId ? { linkedUserId } : {}),
    platform: platform === 'mobile' ? 'mobile' : 'web',
    ...(redirectUri ? { redirectUri } : {}),
    ...(codeChallenge ? { codeChallenge } : {}),
  };
}

export function validateOAuthStateAndGetMode(
  req: Request,
  res: Response,
  stateCookieName: string
): OAuthStateResult | null {
  const state = req.query.state as string;
  const storedState = req.cookies[stateCookieName];

  const decoded = decodeOAuthState(storedState || '');

  // Re-check against the current allowlist: it may have changed while the user
  // was on the consent screen, and a redirect target is worth validating on both
  // sides of a round trip.
  const mobileOutcome = resolveDecodedMobileOutcome(decoded);

  if (!state || !storedState || state !== decoded.stateValue) {
    // Deep-link the failure back when the decoded target survives re-validation,
    // rather than stranding the user on JSON. Trusted because the allowlist just
    // approved it, not because the cookie said so.
    //
    // The message says "sign in again" rather than naming CSRF: the overwhelming
    // majority of the users who see it are victims of an expired cookie, a stale
    // bookmarked callback, or a back button — not of an attack. Someone actually
    // forging a state learns nothing from being told so, while everyone else is
    // handed an accusation instead of the one action that fixes it. `invalid_state`
    // still identifies the case precisely for anything branching on it.
    sendOAuthError(
      res,
      400,
      'Your sign-in session has expired. Please sign in again.',
      mobileOutcome ?? { platform: 'web' },
      'invalid_state'
    );
    return null;
  }

  res.clearCookie(stateCookieName);

  if (decoded.platform === 'mobile' && !mobileOutcome) {
    sendOAuthError(
      res,
      400,
      'Invalid OAuth redirect target.',
      { platform: 'web' },
      'invalid_redirect'
    );
    return null;
  }

  return {
    mode: decoded.mode,
    ...(decoded.linkedUserId ? { linkedUserId: decoded.linkedUserId } : {}),
    platform: decoded.platform,
    ...(decoded.redirectUri ? { redirectUri: decoded.redirectUri } : {}),
    ...(decoded.codeChallenge ? { codeChallenge: decoded.codeChallenge } : {}),
  };
}

/**
 * Mobile outcome for an already-decoded state cookie, or null when the flow is
 * not mobile or its target no longer passes the allowlist.
 *
 * Used to answer "can this failure be deep-linked back into the app?" on error
 * paths that run before — or instead of — a successful state validation.
 */
function resolveDecodedMobileOutcome(decoded: {
  platform: OAuthPlatform;
  redirectUri?: string;
  codeChallenge?: string;
}): OAuthErrorTarget | null {
  if (decoded.platform !== 'mobile') return null;
  if (!decoded.redirectUri || !isAllowedMobileRedirectUrl(decoded.redirectUri)) return null;

  return { platform: 'mobile', redirectUri: decoded.redirectUri };
}

/**
 * Mobile outcome recovered from the raw state cookie, for failures that happen
 * before the state is validated at all — a missing `code`, or a consent screen
 * the user declined. The provider sends those back to the same callback with no
 * usable query state, but the cookie still says where the app lives.
 */
export function resolveMobileOutcomeFromCookie(
  req: Request,
  stateCookieName: string
): OAuthErrorTarget | null {
  return resolveDecodedMobileOutcome(decodeOAuthState(req.cookies?.[stateCookieName] || ''));
}

/**
 * Explains why a redirect URI was rejected, in terms of what to change.
 *
 * Every scheme is a legitimate target — Expo Web serves the app over https,
 * Expo Go over exp:// — so the scheme only selects which hint to add.
 *
 * Classifies rather than echoes: the URI is caller-controlled and this message
 * reaches `authConfig.errorComponent`, which renders unescaped HTML.
 */
function describeRejectedRedirectUri(redirectUri: string): string {
  const configured = getAllowedMobileRedirectUrls();

  if (configured.length === 0) {
    return (
      'Mobile sign-in is not configured: auth.mobile.redirectUrls is empty. ' +
      "Add your app's deep link (e.g. 'myapp://auth') to enable it."
    );
  }

  let protocol: string;
  try {
    protocol = new URL(redirectUri).protocol.toLowerCase();
  } catch {
    return (
      "This redirectUri is not a valid URL. Pass your app's deep link, " +
      "e.g. 'myapp://auth', and list it in auth.mobile.redirectUrls."
    );
  }

  // http(s) and exp: are legitimate — Expo Web and Expo Go serve the app over
  // them — so the advice matches any other scheme, plus a note on why the value
  // differs between build targets.
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'exp:') {
    return (
      'This redirectUri is not in auth.mobile.redirectUrls. Add it verbatim. ' +
      'Note that Linking.createURL returns a different value per build target — ' +
      "your app's scheme in a native build, an https URL on Expo Web, an exp:// URL " +
      'in Expo Go — so each one you test needs its own entry.'
    );
  }

  return (
    'This redirectUri is not in auth.mobile.redirectUrls. Add it verbatim — ' +
    'entries match on scheme, host and path, so a differing path or port is a different target.'
  );
}

/**
 * Reads and validates the mobile handoff parameters from an OAuth initiation
 * request. Returns null when the request is not a mobile flow.
 *
 * Validation happens here, before the redirect to the provider, so a
 * misconfigured or malicious target fails immediately instead of after the user
 * has already granted consent.
 */
export function resolveMobileRedirectRequest(
  req: Request,
  res: Response,
  mode: string
): { ok: true; redirectUri: string | null; codeChallenge: string | null } | { ok: false } {
  if (req.query.platform !== 'mobile') {
    return { ok: true, redirectUri: null, codeChallenge: null };
  }

  const redirectUri = typeof req.query.redirectUri === 'string' ? req.query.redirectUri : '';

  if (!redirectUri) {
    sendOAuthError(res, 400, 'A redirectUri is required for mobile authentication.');
    return { ok: false };
  }

  if (!isAllowedMobileRedirectUrl(redirectUri)) {
    // The full value goes to the log, not the response: `errorMessage` reaches
    // `authConfig.errorComponent`, whose HTML is sent unescaped, so echoing
    // caller-controlled text back would hand app authors an XSS foot-gun.
    console.error(
      `[modelence] Rejected mobile OAuth redirectUri: ${JSON.stringify(redirectUri)}. ` +
        `Allowed: ${JSON.stringify(getAllowedMobileRedirectUrls())}`
    );

    sendOAuthError(
      res,
      400,
      describeRejectedRedirectUri(redirectUri),
      undefined,
      'invalid_redirect'
    );
    return { ok: false };
  }

  const rawChallenge = typeof req.query.codeChallenge === 'string' ? req.query.codeChallenge : '';
  const hasValidChallenge = /^[A-Za-z0-9._~-]{16,256}$/.test(rawChallenge);

  // Only a login mints an exchange code, so only a login needs the binding. An
  // omitted challenge there would produce an unbound code, redeemable by anyone
  // — including a victim mid-flow whose verifier the server would then ignore.
  // Linking redirects with `linked=<provider>` and no credential, so there is
  // nothing to bind. The charset is constrained because a colon would corrupt
  // the delimiter-separated state cookie.
  if (mode !== 'link' && !hasValidChallenge) {
    sendOAuthError(
      res,
      400,
      'This sign-in request is missing a valid codeChallenge. Update the Modelence ' +
        'client package — signInWithOAuth generates it automatically.'
    );
    return { ok: false };
  }

  return { ok: true, redirectUri, codeChallenge: hasValidChallenge ? rawChallenge : null };
}

/**
 * Everything an OAuth initiation route needs to do between "auth is configured"
 * and "redirect the user to the provider": validate the mobile handoff, resolve
 * a link nonce, and build the state cookie value.
 *
 * Shared so a newly added provider cannot quietly ship a mobile flow that skips
 * redirect validation or device binding. Returns null when a response has
 * already been sent.
 */
export async function prepareOAuthInitiation(
  req: Request,
  res: Response,
  stateCookieName: string
): Promise<{ state: string; mode: string } | null> {
  const state = randomBytes(32).toString('hex');
  const mode = req.query.mode === 'link' ? 'link' : 'login';

  // Validate the mobile deep link before leaving the app, so a bad target
  // fails here rather than after the user has granted consent.
  const mobileRequest = resolveMobileRedirectRequest(req, res, mode);
  if (!mobileRequest.ok) return null;
  const { redirectUri: mobileRedirectUri, codeChallenge } = mobileRequest;

  // React Native: consume single-use nonce and embed resolved userId in state cookie.
  let linkedUserId: string | null = null;
  if (mode === 'link' && req.query.linkNonce) {
    linkedUserId = await resolveUserIdFromLinkNonce(req.query.linkNonce as string);
    if (!linkedUserId) {
      // The redirect target was validated just above, so an expired nonce can
      // be reported into the app rather than as JSON in the device browser.
      sendOAuthError(
        res,
        401,
        'Invalid or expired link nonce for OAuth linking.',
        mobileRedirectUri ? { platform: 'mobile', redirectUri: mobileRedirectUri } : undefined,
        'invalid_link_nonce'
      );
      return null;
    }
  }

  const stateValue = encodeOAuthState({
    state,
    mode,
    linkedUserId,
    platform: mobileRedirectUri ? 'mobile' : 'web',
    redirectUri: mobileRedirectUri,
    codeChallenge,
  });

  res.cookie(stateCookieName, stateValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: time.minutes(10),
  });

  return { state, mode };
}

export async function handleOAuthProviderLink(
  req: Request,
  res: Response,
  userData: OAuthUserData,
  linkedUserId?: string,
  outcome: OAuthOutcome = { platform: 'web' }
): Promise<void> {
  const authConfig = getAuthConfig();
  const { session, connectionInfo } = await getCallContext(req, res);

  // React Native: linkedUserId (from state cookie) takes precedence over the
  // browser session, which may belong to a different user.
  let resolvedUserId: ObjectId | null = null;
  if (linkedUserId) {
    if (!ObjectId.isValid(linkedUserId)) {
      clearOAuthLinkCookie(res);
      sendOAuthError(res, 400, 'Invalid OAuth linking state.', outcome);
      return;
    }
    resolvedUserId = new ObjectId(linkedUserId);
  } else {
    resolvedUserId = session?.userId ?? null;
  }

  if (!resolvedUserId) {
    clearOAuthLinkCookie(res);
    sendOAuthError(res, 401, 'You must be signed in to link a provider.', outcome);
    return;
  }

  const userId = resolvedUserId;

  try {
    // Atomically attach the provider to the current user while preventing
    // overwriting an existing provider ID on the same user.
    // A unique index on the provider ID ensures it cannot be linked to another user.
    const providerField = `authMethods.${userData.providerName}.id`;

    const updateResult = await usersCollection.updateOne(
      {
        _id: userId,
        status: { $nin: ['deleted', 'disabled'] },
        $or: [{ [providerField]: { $exists: false } }, { [providerField]: userData.id }],
      },
      {
        $set: {
          [providerField]: userData.id,
        },
      }
    );

    // If no document matched, figure out why
    if (updateResult.matchedCount === 0) {
      const currentUser = await usersCollection.findOne({ _id: userId });

      if (!currentUser || currentUser.status === 'deleted' || currentUser.status === 'disabled') {
        safelyCallHook(() =>
          authConfig.onOAuthLinkError?.({
            provider: userData.providerName,
            error: new Error('User account not found or not active'),
            session,
            connectionInfo,
          })
        );

        clearOAuthLinkCookie(res);

        sendOAuthError(res, 400, 'User account is not active.', outcome);
        return;
      }

      // Detect if the user already linked a different OAuth account
      const existingProviderId = currentUser?.authMethods?.[userData.providerName]?.id;

      if (existingProviderId && existingProviderId !== userData.id) {
        safelyCallHook(() =>
          authConfig.onOAuthLinkError?.({
            provider: userData.providerName,
            error: new Error(
              `User already has a different ${userData.providerName} account linked`
            ),
            session,
            connectionInfo,
          })
        );

        clearOAuthLinkCookie(res);

        sendOAuthError(
          res,
          400,
          `You have already linked a different ${userData.providerName} account.`,
          outcome
        );
        return;
      }

      // Fallback safety guard in case the DB state does not match any expected branch
      safelyCallHook(() =>
        authConfig.onOAuthLinkError?.({
          provider: userData.providerName,
          error: new Error(`Unexpected OAuth linking state for ${userData.providerName}`),
          session,
          connectionInfo,
        })
      );

      clearOAuthLinkCookie(res);

      sendOAuthError(res, 400, `Unable to link ${userData.providerName} account.`, outcome);
      return;
    }

    const updatedUser = await usersCollection.findOne(
      { _id: userId },
      { readPreference: 'primary' }
    );

    if (updatedUser) {
      safelyCallHook(() =>
        authConfig.onAfterOAuthLink?.({
          provider: userData.providerName,
          user: updatedUser,
          session,
          connectionInfo,
        })
      );
    }

    // Redirect back to the app after successful link. On mobile this returns to
    // the deep link with no code: linking happens for an already-signed-in user,
    // so there is no new session to hand over.
    clearOAuthLinkCookie(res);

    if (outcome.platform === 'mobile') {
      res.set('Referrer-Policy', 'no-referrer');
      res.redirect(buildMobileRedirect(outcome.redirectUri, { linked: userData.providerName }));
      return;
    }

    res.redirect('/');
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      safelyCallHook(() =>
        authConfig.onOAuthLinkError?.({
          provider: userData.providerName,
          error,
          session,
          connectionInfo,
        })
      );

      clearOAuthLinkCookie(res);

      sendOAuthError(
        res,
        400,
        `This ${userData.providerName} account is already linked to a different user.`,
        outcome
      );
      return;
    }

    if (error instanceof Error) {
      safelyCallHook(() =>
        authConfig.onOAuthLinkError?.({
          provider: userData.providerName,
          error,
          session,
          connectionInfo,
        })
      );
    }

    clearOAuthLinkCookie(res);
    if (!res.headersSent) {
      throw error;
    }
  }
}

export function validateOAuthCode(code: unknown): string | null {
  if (!code || typeof code !== 'string') {
    return null;
  }
  return code;
}
