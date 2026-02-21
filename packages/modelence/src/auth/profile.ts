import { usersCollection } from './db';
import { Args, Context, UpdateProfileArgs } from '../methods/types';
import { validateProfileFields } from './validators';
import { getAuthConfig } from '@/app/authConfig';

export async function getOwnProfile(_args: Args, { user }: Context) {
  if (!user) {
    throw new Error('Not authenticated');
  }

  const profile = await usersCollection.requireById(user.id);

  return {
    handle: profile.handle,
    emails: profile.emails,
    authMethods: Object.keys(profile.authMethods || {}),
    firstName: profile.firstName ?? undefined,
    lastName: profile.lastName ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
  };
}

export async function handleUpdateProfile(_args: UpdateProfileArgs, { user }: Context) {
  if (!user) {
    throw new Error('Not authenticated');
  }

  let profile = await usersCollection.requireById(user.id);

  await getAuthConfig().validateProfileUpdate?.(_args);

  const update = validateProfileFields(_args);

  //Check if handle is already taken
  if ('handle' in update && update.handle !== undefined) {
    const existing = await usersCollection.findOne(
      {
        handle: update.handle,
        _id: { $ne: profile._id }, // excludes the current user
      },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (existing) {
      throw new Error('Handle already taken.');
    }
  }

  //Update profile
  if (Object.keys(update).length > 0) {
    try {
      await usersCollection.updateOne({ _id: profile._id }, { $set: update });
      profile = { ...profile, ...update } as typeof profile;
    } catch (error) {
      throw new Error('Failed to update profile.');
    }
  }

  return {
    user: {
      id: profile._id,
      handle: profile.handle,
      roles: profile.roles || [],
      firstName: profile.firstName ?? undefined,
      lastName: profile.lastName ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
    },
  };
}
