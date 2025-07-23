import { z } from 'zod';

import { Args, Context } from '../methods/types';
import { usersCollection, tokensCollection } from './db';
import { setSessionUser } from './session';

export async function handleVerifyEmail(args: Args, { session }: Context) {
  if (!session) {
    throw new Error('Session is not initialized');
  }

  const token = z.string().parse(args.token);

  // Find token in database
  const tokenDoc = await tokensCollection.findOne({
    token,
    type: 'emailVerification',
    expiresAt: { $gt: new Date() }
  });

  if (!tokenDoc) {
    throw new Error('Invalid or expired verification token');
  }

  // Find user by token's userId
  const userDoc = await usersCollection.findOne({ _id: tokenDoc.userId });

  if (!userDoc) {
    throw new Error('User not found');
  }

  const email = tokenDoc.email;

  if (!email) {
    throw new Error('Email not found in token');
  }

  // Find the specific email address to verify
  const emailIndex = userDoc.emails?.findIndex(e => e.address === email);
  
  if (!userDoc.emails || emailIndex === undefined || emailIndex === -1) {
    throw new Error('Email address not found for this user');
  }

  if (userDoc.emails[emailIndex].verified) {
    throw new Error('Email is already verified');
  }

  // Mark the specific email as verified
  await usersCollection.updateOne(
    { _id: tokenDoc.userId },
    { $set: { [`emails.${emailIndex}.verified`]: true } }
  );

  // Delete the used token
  await tokensCollection.deleteOne({ _id: tokenDoc._id });

  // Set session user
  await setSessionUser(session.authToken, tokenDoc.userId);

  return {
    user: {
      id: userDoc._id,
      handle: userDoc.handle,
      emailVerified: true,
    },
  };
}
