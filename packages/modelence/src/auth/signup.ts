import { z } from 'zod';
import bcrypt from 'bcrypt';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';

export async function handleSignupWithPassword(args: Args, { user }: Context) {
  const email = z.string().email().parse(args.email);
  const password = z.string()
    .min(8, { message: 'Password must contain at least 8 characters' })
    .parse(args.password);

  // TODO: block disposable email providers
  // TODO: captcha check
  // TODO: rate limiting

  if (user) {
    // TODO: handle cases where a user is already logged in
  }

  const existingUser = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (existingUser) {
    const existingEmail = existingUser.emails?.find(e => e.address === email);
    throw new Error(`User with email already exists: ${existingEmail?.address}`);
  }

  // Hash password with bcrypt (salt is automatically generated)
  const hash = await bcrypt.hash(password, 10);

  const result = await usersCollection.insertOne({
    handle: email,
    emails: [{
      address: email,
      verified: false,
    }],
    createdAt: new Date(),
    authMethods: {
      password: {
        hash,
      }
    }
  });

  // TODO: send verification email

  return result.insertedId;
}

