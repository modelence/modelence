import bcrypt from 'bcrypt';
import { z } from 'zod';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { serializeUserForClient } from './utils';
import {
  clearAuthTokenCookie,
  clearSessionUser,
  setAuthTokenCookie,
  setSessionUser,
} from './session';
import { getEmailConfig } from '@/app/emailConfig';
import { consumeRateLimit } from '@/server';
import { validateEmail } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { getConfig } from '@/config/server';
import { AuthError } from '../error';

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

export async function handleLoginWithPassword(
  args: Args,
  { user, session, connectionInfo, res }: Context
) {
  try {
    if (!session) {
      throw new Error('Session is not initialized');
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

    // TODO: add rate limiting by email (and perhaps IP address overall)

    if (user) {
      throw new Error('You are already logged in.');
    }

    const userDoc = await usersCollection.findOne(
      { 'emails.address': email, status: { $nin: ['deleted', 'disabled'] } },
      { collation: { locale: 'en', strength: 2 } }
    );

    const passwordHash = userDoc?.authMethods?.password?.hash;
    if (!passwordHash) {
      throw incorrectCredentialsError();
    }

    const emailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === email);

    if (!emailDoc?.verified && isEmailVerificationRequired()) {
      throw new AuthError(
        "Your email address hasn't been verified yet. Please check your inbox for the verification email.",
        'EMAIL_NOT_VERIFIED'
      );
    }

    const isValidPassword = await bcrypt.compare(password, passwordHash);
    if (!isValidPassword) {
      throw incorrectCredentialsError();
    }

    await setSessionUser(session.authToken, userDoc._id);

    if (res) {
      setAuthTokenCookie(res, session.authToken);
    }

    getAuthConfig().onAfterLogin?.({
      provider: 'email',
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
  otherwise it would allow for an enumeration attack.
*/
function incorrectCredentialsError() {
  return new Error('Incorrect email/password combination');
}
