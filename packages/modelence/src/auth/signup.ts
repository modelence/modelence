import bcrypt from 'bcrypt';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { isDisposableEmail } from './disposableEmails';
import { consumeRateLimit } from '../rate-limit/rules';
import { sendVerificationEmail } from './verification';
import { validateEmail, validatePassword, validateProfileFields } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { resolveUniqueHandle } from './utils';

export async function handleSignupWithPassword(
  args: Args,
  { user, session, connectionInfo }: Context
) {
  const authConfig = getAuthConfig();
  try {
    const email = validateEmail(args.email as string);
    const password = validatePassword(args.password as string);

    const ip = connectionInfo?.ip;
    if (ip) {
      await consumeRateLimit({
        bucket: 'signupAttempt',
        type: 'ip',
        value: ip,
      });
    }

    if (await isDisposableEmail(email)) {
      throw new Error('Please use a permanent email address');
    }

    // TODO: captcha check

    if (user) {
      // TODO: handle cases where a user is already logged in
    }

    const existingUser = await usersCollection.findOne(
      { 'emails.address': email },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (existingUser) {
      const existingEmail = existingUser.emails?.find((e) => e.address === email);
      if (existingUser.status === 'disabled') {
        throw new Error(
          `User is marked for deletion, please contact support if you want to restore the account.`
        );
      }
      throw new Error(`User with email already exists: ${existingEmail?.address}`);
    }

    if (ip) {
      await consumeRateLimit({
        bucket: 'signup',
        type: 'ip',
        value: ip,
      });
    }

    // Validate optional profile fields (firstName, lastName, avatarUrl)
    const profileFields = validateProfileFields({
      firstName: args.firstName as string | undefined,
      lastName: args.lastName as string | undefined,
      avatarUrl: args.avatarUrl as string | undefined,
    });

    await authConfig.validateSignUp?.({
      email,
      password,
      handle: args.handle as string | undefined,
      ...profileFields,
    });

    // Resolve a unique handle (from args, custom generator, or derived from email).
    let handle: string;

    if (args.handle) {
      handle = await resolveUniqueHandle(args.handle as string, email);
    } else if (authConfig.generateHandle) {
      const generated = await authConfig.generateHandle({ email, ...profileFields });
      handle = await resolveUniqueHandle(generated, email);
    } else {
      handle = await resolveUniqueHandle(undefined, email);
    }

    // Hash password with bcrypt (salt is automatically generated)
    const hash = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      handle,
      status: 'active',
      emails: [
        {
          address: email,
          verified: false,
        },
      ],
      createdAt: new Date(),
      authMethods: {
        password: {
          hash,
        },
      },
      ...(profileFields.firstName !== undefined && { firstName: profileFields.firstName }),
      ...(profileFields.lastName !== undefined && { lastName: profileFields.lastName }),
      ...(profileFields.avatarUrl !== undefined && { avatarUrl: profileFields.avatarUrl }),
    });

    const userDocument = await usersCollection.findOne(
      { _id: result.insertedId },
      { readPreference: 'primary' }
    );

    if (!userDocument) {
      throw new Error('User not found');
    }

    await sendVerificationEmail({
      userId: result?.insertedId,
      email,
      baseUrl: connectionInfo?.baseUrl,
    });

    authConfig.onAfterSignup?.({
      provider: 'email',
      user: userDocument,
      session,
      connectionInfo,
    });

    authConfig.signup?.onSuccess?.(userDocument);

    return result.insertedId;
  } catch (error) {
    if (error instanceof Error) {
      authConfig.onSignupError?.({
        provider: 'email',
        error,
        session,
        connectionInfo,
      });

      authConfig.signup?.onError?.(error);
    }
    throw error;
  }
}
