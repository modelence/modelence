import { z } from 'zod';

import { usersCollection, emailVerificationTokensCollection } from './db';
import { RouteParams, RouteResponse } from '@/server';
import { getEmailConfig } from '@/app/emailConfig';

export async function handleVerifyEmail(params: RouteParams): Promise<RouteResponse> {
  const emailVerifiedRedirectUrl = getEmailConfig().emailVerifiedRedirectUrl || '/';
  try {
    const token = z.string().parse(params.query.token);
    // Find token in database
    const tokenDoc = await emailVerificationTokensCollection.findOne({
      token,
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

    // Mark the specific email as verified atomically
    const updateResult = await usersCollection.updateOne(
      { 
        _id: tokenDoc.userId,
        'emails.address': email,
        'emails.verified': { $ne: true }
      },
      { $set: { 'emails.$.verified': true } }
    );

    if (updateResult.matchedCount === 0) {
      // Check if email exists but is already verified
      const existingUser = await usersCollection.findOne({
        _id: tokenDoc.userId,
        'emails.address': email
      });
      
      if (existingUser) {
        throw new Error('Email is already verified');
      } else {
        throw new Error('Email address not found for this user');
      }
    }

    // Delete the used token
    await emailVerificationTokensCollection.deleteOne({ _id: tokenDoc._id });
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error verifying email:', error);
      return {
        status: 301,
        redirect: `${emailVerifiedRedirectUrl}?status=error&message=${encodeURIComponent(error.message)}`,
      };
    }
  }

  return {
    status: 301,
    redirect: `${emailVerifiedRedirectUrl}?status=verified`,
  };
}
