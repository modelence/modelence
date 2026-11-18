import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import {
  usersCollection,
  emailVerificationTokensCollection,
  resetPasswordTokensCollection,
  magicLinkTokensCollection,
} from './db';
import { invalidateAllUserSessions } from './session';

export async function clearTokens(userId: ObjectId) {
  await emailVerificationTokensCollection.deleteMany({
    userId,
  });

  await resetPasswordTokensCollection.deleteMany({
    userId,
  });

  // Magic link tokens and one-time codes are keyed by email, not userId, so they
  // must be revoked by the user's addresses. Without this, disabling a user leaves
  // any link issued before the disable able to authenticate once re-enabled, and
  // (with allowSignup) a deleted user's old link could create a fresh account for
  // the same email. Read the user before the caller wipes `emails`. Magic link
  // tokens are stored under the `validateEmail`-lowercased address while stored
  // addresses may keep original casing (e.g. OAuth accounts), so match lowercased.
  const userDoc = await usersCollection.findOne({ _id: userId });
  const userEmails = Array.from(
    new Set(
      (userDoc?.emails ?? [])
        .map((e) => e.address?.toLowerCase())
        .filter((address): address is string => Boolean(address))
    )
  );
  if (userEmails.length > 0) {
    await magicLinkTokensCollection.deleteMany({ email: { $in: userEmails } });
  }
}

export async function disableUser(userId: ObjectId) {
  await clearTokens(userId);

  await usersCollection.updateOne(
    {
      _id: userId,
    },
    {
      $set: {
        status: 'disabled',
        disabledAt: new Date(),
      },
    }
  );

  // Invalidate sessions after updating the user's status so that no new session
  // can be created during cleanup and survive account re-enablement.
  await invalidateAllUserSessions(userId);
}

export async function deleteUser(userId: ObjectId) {
  await clearTokens(userId);

  await usersCollection.updateOne(
    {
      _id: userId,
    },
    {
      $set: {
        handle: `deleted-${userId}-${randomUUID()}`,
        status: 'deleted',
        deletedAt: new Date(),
        authMethods: {},
        emails: [],
      },
    }
  );

  // Invalidate sessions after updating status so no orphaned sessions remain.
  await invalidateAllUserSessions(userId);
}
