import bcrypt from 'bcrypt';
import { SignupProps, Context, Args } from '../methods/types';
import { usersCollection } from './db';
import { isDisposableEmail } from './disposableEmails';
import { consumeRateLimit } from '../rate-limit/rules';
import { sendVerificationEmail } from './verification';
import { validateEmail, validatePassword, validateProfileFields } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { resolveUniqueHandle } from './utils';

export async function handleSignupWithPassword(
  props: Args,
  { user, session, connectionInfo }: Context
) {
  const authConfig = getAuthConfig();
  try {
    // Narrow once at the boundary
    const signupProps = props as SignupProps;
    const { firstName, lastName, avatarUrl, handle } = signupProps;

    const email = validateEmail(signupProps.email);
    const password = validatePassword(signupProps.password);

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

    // Validate optional profile fields (firstName, lastName, avatarUrl, handle)
    const profileFields = validateProfileFields({
      firstName,
      lastName,
      avatarUrl,
      handle,
    });

    await authConfig.validateSignup?.({
      email,
      password,
      ...profileFields,
    });

    // Resolve unique handle
    let resolvedHandle: string;

    if (profileFields.handle) {
      resolvedHandle = await resolveUniqueHandle(profileFields.handle, email);
    } else if (authConfig.generateHandle) {
      const generated = await authConfig.generateHandle({
        email,
        ...profileFields,
      });

      resolvedHandle = await resolveUniqueHandle(generated, email, {
        throwOnConflict: false,
      });
    } else {
      resolvedHandle = await resolveUniqueHandle(undefined, email);
    }

    // Hash password with bcrypt (salt is automatically generated)
    const hash = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      handle: resolvedHandle,
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
