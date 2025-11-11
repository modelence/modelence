import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import {
  usersCollection,
  emailVerificationTokensCollection,
  resetPasswordTokensCollection,
} from './db';

export async function clearTokens(userId: ObjectId) {
  await emailVerificationTokensCollection.deleteMany({
    userId,
  });

  await resetPasswordTokensCollection.deleteMany({
    userId,
  });
}

export async function softDeleteUser(userId: ObjectId) {
  await clearTokens(userId);

  await usersCollection.updateOne(userId, {
    $set: {
      deletedAt: new Date(),
    },
  });
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
        deletedAt: new Date(),
        authMethods: {},
        emails: [],
      },
    }
  );
}
