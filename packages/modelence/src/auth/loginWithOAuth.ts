import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { getAuthConfig } from '@/app/authConfig';
import { consumeRateLimit } from '@/server';
import { AuthError, ValidationError } from '../error';
import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { consumeOAuthExchangeCode, setSessionUser } from './session';
import type { OAuthProvider } from './types';
import { serializeUserForClient } from './utils';

/**
 * Same message whether the code is unknown, already redeemed, expired, or bound
 * to an account that is no longer active — the client has no legitimate use for
 * the distinction, and telling them apart would let a caller probe for valid codes.
 */
function invalidCodeError() {
  return new AuthError('Invalid or expired sign-in code', 'INVALID_OAUTH_CODE');
}

/**
 * Completes a native OAuth sign-in by exchanging the single-use code the
 * callback deep-linked back to the app for a real session.
 *
 * This is the second half of the mobile flow: the OAuth callback authenticates
 * the user through the ordinary find-or-create path and mints a code, and the
 * app redeems it here over TLS. The session is created at this point rather
 * than in the callback, so a code that is intercepted but never redeemed never
 * corresponds to a live session.
 */
export async function handleLoginWithOAuth(args: Args, { user, session, connectionInfo }: Context) {
  // Known only after the code is redeemed; until then a failure can't be
  // attributed to a specific provider.
  let provider: OAuthProvider | undefined;

  try {
    if (!session) {
      throw new Error('Session is not initialized');
    }

    // Matches handleLoginWithPassword: an authenticated session must not be
    // silently rebound to another account by a code arriving from anywhere.
    if (user) {
      throw new ValidationError('User is already authenticated', 'ALREADY_AUTHENTICATED');
    }

    const ip = connectionInfo?.ip;
    if (ip) {
      await consumeRateLimit({
        bucket: 'oauthExchange',
        type: 'ip',
        value: ip,
      });
    }

    const code = z.string().min(1).parse(args.code);

    // Optional at the schema level so a code minted by a previous-version
    // instance mid-deploy is still redeemable; whether it is actually required
    // is decided by the challenge stored with the code.
    const codeVerifier = z
      .string()
      .min(1)
      .optional()
      .parse(args.codeVerifier ?? undefined);

    // Commit point: single-use, so concurrent redemptions resolve to one winner.
    // Also where the device binding is enforced — a code minted against another
    // device's challenge does not survive this call.
    const claimed = await consumeOAuthExchangeCode(code, codeVerifier);
    if (!claimed || !ObjectId.isValid(claimed.userId)) {
      throw invalidCodeError();
    }
    provider = claimed.provider;

    // Re-check status here: the account may have been disabled between the
    // callback minting this code and the app redeeming it.
    const userDoc = await usersCollection.findOne({
      _id: new ObjectId(claimed.userId),
      status: { $nin: ['deleted', 'disabled'] },
    });

    if (!userDoc) {
      throw invalidCodeError();
    }

    await setSessionUser(session.authToken, userDoc._id);

    getAuthConfig().onAfterLogin?.({
      provider,
      user: userDoc,
      session,
      connectionInfo,
    });
    getAuthConfig().login?.onSuccess?.(userDoc);

    return {
      user: serializeUserForClient(userDoc),
      session: { authToken: session.authToken },
    };
  } catch (error) {
    if (error instanceof Error && provider) {
      getAuthConfig().onLoginError?.({
        provider,
        error,
        session,
        connectionInfo,
      });
      getAuthConfig().login?.onError?.(error);
    }
    throw error;
  }
}
