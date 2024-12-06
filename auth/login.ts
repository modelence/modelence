import { z } from 'zod';
import bcrypt from 'bcrypt';

import { Args, Context } from '../methods/types';
import { usersCollection } from './user';
import { setSessionUser } from './session';

export async function handleLoginWithPassword(args: Args, { user, session }: Context) {
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

  const passwordHash = userDoc?.authMethods?.password?.hash;
  if (!userDoc || !passwordHash) {
    throw incorrectCredentialsError();
  }

  const isValidPassword = await bcrypt.compare(password, passwordHash);
  if (!isValidPassword) {
    throw incorrectCredentialsError();
  }

  setSessionUser(session.authToken, userDoc._id);

  return userDoc._id;
}

/*
  It is important to return the same exact error both in case the email
  or password is incorrect so that the client cannot tell the difference,
  otherwise it would allow for an enumeration attack.
*/
function incorrectCredentialsError() {
  return new Error('Incorrect email/password combination');
}
