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

export async function disableUser(userId: ObjectId) {
  await clearTokens(userId);

  await usersCollection.updateOne(userId, {
    $set: {
      status: 'disabled',
      disabledAt: new Date(),
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
        status: 'deleted',
        deletedAt: new Date(),
        authMethods: {},
        emails: [],
      },
    }
  );
}
