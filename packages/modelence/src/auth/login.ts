import bcrypt from 'bcrypt';
import { z } from 'zod';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { clearSessionUser, setSessionUser } from './session';

export async function handleLoginWithPassword(args: Args, { user, session }: Context) {
  if (!session) {
    throw new Error('Session is not initialized');
  }

  const email = z.string().email().parse(args.email);
  const password = z.string().parse(args.password);

  // TODO: add rate limiting by email (and perhaps IP address overall)

  if (user) {
    // TODO: handle cases where a user is already logged in
  }

  // TODO: check if the email is verified
  const userDoc = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  const passwordHash = userDoc?.authMethods?.password?.hash;
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
