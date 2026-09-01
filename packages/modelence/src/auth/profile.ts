import { usersCollection } from './db';
import { Args, Context, UpdateProfileProps } from '../methods/types';
import { serializeUserForClient } from './utils';
import { validateProfileFields } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { consumeRateLimit } from '../rate-limit/rules';
import { AuthError, ValidationError } from '../error';

export async function getOwnProfile(props: Args, { user }: Context) {
  if (!user) {
    throw new AuthError('Not authenticated');
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

export async function handleUpdateProfile(props: Args, { user }: Context) {
  if (!user) {
    throw new AuthError('Not authenticated');
  }

  let profile = await usersCollection.requireById(user.id);

  const rawProps = props as UpdateProfileProps;
  const isHandleUnchanged =
    typeof rawProps.handle === 'string' && rawProps.handle.trim() === profile.handle;

  const { handle: _ignoredHandle, ...propsWithoutHandle } = rawProps;
  const update = validateProfileFields(
    isHandleUnchanged ? (propsWithoutHandle as UpdateProfileProps) : rawProps
  );

  await getAuthConfig().validateProfileUpdate?.(update);

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
      throw new ValidationError('Handle already taken.');
    }
  }

  //Update profile
  if (Object.keys(update).length > 0) {
    await consumeRateLimit({ bucket: 'updateProfile', type: 'user', value: user.id });

    const setFields: Record<string, unknown> = {}; //Used to set the fields
    const unsetFields: Record<string, ''> = {}; //Used to clear the fields the mongodb, because mongodb rejects undefined values when updating fields

    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) {
        unsetFields[key] = '';
      } else {
        setFields[key] = value;
      }
    }

    const mongoUpdate: Record<string, unknown> = {};
    if (Object.keys(setFields).length > 0) mongoUpdate.$set = setFields;
    if (Object.keys(unsetFields).length > 0) mongoUpdate.$unset = unsetFields;

    try {
      await usersCollection.updateOne({ _id: profile._id }, mongoUpdate);

      //Also pass Cleared Fields as UNDEFINED in profile
      const clearedFields = Object.fromEntries(
        Object.keys(unsetFields).map((key) => [key, undefined])
      );
      profile = { ...profile, ...setFields, ...clearedFields } as typeof profile;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code: number }).code === 11000) {
        throw new ValidationError('Handle already taken.');
      }
      throw error;
    }
  }

  return {
    user: serializeUserForClient(profile),
  };
}
