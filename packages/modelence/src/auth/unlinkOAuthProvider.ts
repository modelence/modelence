import { usersCollection } from './db';
import { Args, Context } from '@/methods/types';

export async function handleUnlinkOAuthProvider({ provider }: Args, { user }: Context) {
  if (!user) {
    throw new Error('You must be signed in to unlink a provider.');
  }

  if (typeof provider !== 'string') {
    throw new Error('Invalid provider.');
  }

  // Safety: prevent removing the last auth method
  const userDoc = await usersCollection.requireById(user.id);
  if (!userDoc) {
    throw new Error('User not found.');
  }
  const methods = userDoc.authMethods ?? {};
  const activeMethodsCount = Object.values(methods).filter(Boolean).length;
  // Count whether provider is actually linked
  const providerKey = provider as keyof typeof methods;
  if (!methods[providerKey]) {
    throw new Error(`${provider} is not linked to your account.`);
  }
  // Don't allow removing the only auth method (would lock the user out)
  if (activeMethodsCount <= 1) {
    throw new Error(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
  }
  await usersCollection.updateOne(
    { _id: userDoc._id },
    { $unset: { [`authMethods.${provider}`]: '' } }
  );
}
