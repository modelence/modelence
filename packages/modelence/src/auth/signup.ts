import bcrypt from 'bcrypt';

import { Args, Context } from '../methods/types';
import { usersCollection } from './db';
import { isDisposableEmail } from './disposableEmails';
import { consumeRateLimit } from '../rate-limit/rules';
import { sendVerificationEmail } from './verification';
import { validateEmail, validatePassword } from './validators';
import { getAuthConfig } from '@/app/authConfig';

export async function handleSignupWithPassword(
  args: Args,
  { user, session, connectionInfo }: Context
) {
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
      if (existingUser.deletedAt) {
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

    // Hash password with bcrypt (salt is automatically generated)
    const hash = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      handle: email,
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

    getAuthConfig().onAfterSignup?.({
      user: userDocument,
      session,
      connectionInfo,
    });

    getAuthConfig().signup?.onSuccess?.(userDocument);

    return result.insertedId;
  } catch (error) {
    if (error instanceof Error) {
      getAuthConfig().onSignupError?.({
        error,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onError?.(error);
    }
    throw error;
  }
}
