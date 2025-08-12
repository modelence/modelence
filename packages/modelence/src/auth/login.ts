import bcrypt from 'bcrypt';
import { z } from 'zod';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { clearSessionUser, setSessionUser } from './session';
import { sendVerificationEmail } from './verification';
import { getEmailConfig } from '@/app/emailConfig';
import { consumeRateLimit } from '@/server';

export async function handleLoginWithPassword(args: Args, { user, session, connectionInfo }: Context) {
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

  const email = z.string().email().parse(args.email);
  const password = z.string().parse(args.password);

  // TODO: add rate limiting by email (and perhaps IP address overall)

  if (user) {
    // TODO: handle cases where a user is already logged in
  }

  const userDoc = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!userDoc) {
    throw incorrectCredentialsError();
  }

  const emailDoc = userDoc.emails?.find(e => e.address === email);

  if (!emailDoc?.verified && getEmailConfig()?.provider) {
    if (ip) {
      try {
        await consumeRateLimit({
          bucket: 'verification',
          type: 'user',
          value: userDoc._id.toString(),
        });
      } catch {
        throw new Error("Your email address hasn't been verified yet. Please use the verification email we've send earlier to your inbox.");
      }
    }

    await sendVerificationEmail({
      userId: userDoc?._id,
      email,
      baseUrl: connectionInfo?.baseUrl,
    });
    throw new Error("Your email address hasn't been verified yet. We've sent a new verification email to your inbox.");
  }

  const passwordHash = userDoc.authMethods?.password?.hash;
  if (!userDoc || !passwordHash) {
    throw incorrectCredentialsError();
  }

  const isValidPassword = await bcrypt.compare(password, passwordHash);
  if (!isValidPassword) {
    throw incorrectCredentialsError();
  }

  await setSessionUser(session.authToken, userDoc._id);

  return {
    user: {
      id: userDoc._id,
      handle: userDoc.handle,
    }
  }
}

export async function handleLogout(args: Args, { user, session }: Context) {
  if (!session) {
    throw new Error('Session is not initialized');
  }

  await clearSessionUser(session.authToken);
}

/*
  It is important to return the same exact error both in case the email
  or password is incorrect so that the client cannot tell the difference,
  otherwise it would allow for an enumeration attack.
*/
function incorrectCredentialsError() {
  return new Error('Incorrect email/password combination');
}
