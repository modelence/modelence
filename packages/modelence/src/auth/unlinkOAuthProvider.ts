import { usersCollection } from './db';
import { Args, Context } from '@/methods/types';
import { OAuthProvider, SUPPORTED_OAUTH_PROVIDERS } from './types';

export async function handleUnlinkOAuthProvider({ provider }: Args, { user }: Context) {
  if (!user) {
    throw new Error('You must be signed in to unlink a provider.');
  }

  if (
    typeof provider !== 'string' ||
    !SUPPORTED_OAUTH_PROVIDERS.includes(provider as OAuthProvider)
  ) {
    throw new Error(
      `Invalid provider. Supported providers are: ${SUPPORTED_OAUTH_PROVIDERS.join(', ')}.`
    );
  }

  // requireById throws if user is not found, so no null check needed
  const userDoc = await usersCollection.requireById(user.id);

  const methods = userDoc.authMethods ?? {};
  const providerKey = provider as keyof typeof methods;

  if (!methods[providerKey]) {
    throw new Error(`${provider} is not linked to your account.`);
  }

  const activeMethodsCount = Object.values(methods).filter(Boolean).length;
  if (activeMethodsCount <= 1) {
    throw new Error(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
  }

  // Determine the OTHER auth method fields that must still exist for lockout prevention.
  // This atomic filter ensures that between our read and write, at least one other method
  // hasn't been concurrently removed (prevents two simultaneous unlinks from both succeeding).
  const otherMethods = Object.keys(methods).filter(
    (key) => key !== provider && methods[key as keyof typeof methods]
  );
  const otherMethodGuard =
    otherMethods.length > 0
      ? { $or: otherMethods.map((key) => ({ [`authMethods.${key}`]: { $exists: true } })) }
      : {};

  const result = await usersCollection.updateOne(
    { _id: userDoc._id, ...otherMethodGuard },
    { $unset: { [`authMethods.${provider}`]: '' } }
  );

  if (result.matchedCount === 0) {
    throw new Error(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
  }
}
