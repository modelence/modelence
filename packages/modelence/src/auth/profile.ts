import { usersCollection } from './db';
import { Args, Context } from '../methods/types';

export async function getOwnProfile(_args: Args, { user }: Context) {
  if (!user) {
    throw new Error('Not authenticated');
  }

  const profile = await usersCollection.requireById(user.id);

  return {
    handle: profile.handle,
    emails: profile.emails,
    authMethods: Object.keys(profile.authMethods || {}),
    name: profile.name ?? undefined,
    picture: profile.picture ?? undefined,
  };
}
