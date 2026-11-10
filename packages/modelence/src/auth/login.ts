import { randomBytes } from 'crypto';

import bcrypt from 'bcrypt';
import { z } from 'zod';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { serializeUserForClient } from './utils';
import {
  clearAuthTokenCookie,
  clearSessionUser,
  setAuthTokenCookie,
  startUserSession,
} from './session';
import { getEmailConfig } from '@/app/emailConfig';
import { checkRateLimit, consumeRateLimit, releaseRateLimits } from '@/server';
import { validateEmail } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { getConfig } from '@/config/server';
import { AuthError, ValidationError } from '../error';

/**
 * Whether unverified emails should be blocked from logging in.
 *
 * Verification can only be enforced when an email provider is configured (there
 * is otherwise no way to deliver a verification email). When a provider exists,
 * the `auth.email.verification` config flag acts as the actual switch — it
 * defaults to `true`, preserving the historical behavior where configuring a
 * provider implicitly turned verification on. Operators can now set the flag to
 * `false` to keep a provider while allowing unverified users to sign in.
 */
function isEmailVerificationRequired(): boolean {
  if (!getEmailConfig()?.provider) {
    return false;
  }

  return Boolean(getConfig('_system.user.auth.email.verification'));
}

const SALT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), SALT_ROUNDS);

export async function handleLoginWithPassword(
  args: Args,
  { user, session, connectionInfo, res }: Context
) {
  try {
    if (!session) {
      throw new Error('Session is not initialized');
    }

    if (user) {
      throw new ValidationError('User is already authenticated', 'ALREADY_AUTHENTICATED');
    }

    const ip = connectionInfo?.ip;
    if (ip) {
      await consumeRateLimit({
        bucket: 'signin',
        type: 'ip',
        value: ip,
      });
    }

    const email = validateEmail(args.email as string);
    // password is accepted just as a string, so users can still sign in if the password validation rules are changed
    const password = z.string().parse(args.password);

    // Block before comparing passwords so an exhausted email budget cannot be
    // bypassed by a correct password. Known and unknown emails hit the same
    // check, so the response does not reveal whether the account exists.
    await checkRateLimit({
      bucket: 'signin',
      type: 'email',
      value: email,
    });
    const userDoc = await usersCollection.findOne(
      { 'emails.address': email, status: { $nin: ['deleted', 'disabled'] } },
      { collation: { locale: 'en', strength: 2 } }
    );

    const passwordHash = userDoc?.authMethods?.password?.hash;

    // The check above is only a snapshot, so concurrent guesses could all pass
    // it. Reserve a slot atomically before bcrypt; it is released on success,
    // so only failed attempts count against the email limit.
    const emailReservations = await consumeRateLimit({
      bucket: 'signin',
      type: 'email',
      value: email,
    });

    // Always run bcrypt.compare to mitigate timing attacks that could reveal if an email exists.
    const hashToCompare = passwordHash || DUMMY_PASSWORD_HASH;
    let isValidPassword: boolean;
    try {
      isValidPassword = await bcrypt.compare(password, hashToCompare);
    } catch (error) {
      // The password was never compared, so this attempt should not count.
      try {
        await releaseRateLimits(emailReservations);
      } catch (releaseError) {
        console.error('Failed to release email rate limit reservation', releaseError);
      }
      throw error;
    }

    if (!passwordHash || !isValidPassword) {
      // Keep the reservation counted: only failed attempts count against the
      // email limit.
      throw incorrectCredentialsError();
    }

    // The password is correct, so release the reserved attempt. A failed
    // release must not block a valid login; the worst case is one extra attempt
    // counted against the email.
    try {
      await releaseRateLimits(emailReservations);
    } catch (error) {
      console.error('Failed to release email rate limit reservation', error);
    }

    // Only check email verification if the user exists and the password is correct,
    // to prevent email enumeration by observing verification errors before password checks.
    const emailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === email);

    if (!emailDoc?.verified && isEmailVerificationRequired()) {
      throw new AuthError(
        "Your email address hasn't been verified yet. Please check your inbox for the verification email.",
        'EMAIL_NOT_VERIFIED'
      );
    }

    const userSession = await startUserSession(session.authToken, userDoc._id);

    if (res) {
      setAuthTokenCookie(res, userSession.authToken);
    }

    getAuthConfig().onAfterLogin?.({
      provider: 'email',
      user: userDoc,
      session: userSession,
      connectionInfo,
    });
    getAuthConfig().login?.onSuccess?.(userDoc);

    return {
      user: serializeUserForClient(userDoc),
      session: { authToken: userSession.authToken },
    };
  } catch (error) {
    if (error instanceof Error) {
      getAuthConfig().onLoginError?.({
        provider: 'email',
        error,
        session,
        connectionInfo,
      });
      getAuthConfig().login?.onError?.(error);
    }
    throw error;
  }
}

export async function handleLogout(args: Args, { session, res }: Context) {
  if (!session) {
    throw new Error('Session is not initialized');
  }

  await clearSessionUser(session.authToken);

  if (res) {
    clearAuthTokenCookie(res);
  }
}

/*
  It is important to return the same exact error both in case the email
  or password is incorrect so that the client cannot tell the difference,
  otherwise it would allow for an enumeration attack. An AuthError, so wrong
  credentials answer 401 rather than being reported as a 500 server error.
*/
function incorrectCredentialsError() {
  return new AuthError('Incorrect email/password combination');
}
