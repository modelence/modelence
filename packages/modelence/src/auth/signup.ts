import bcrypt from 'bcrypt';
import { SignupProps, Context, Args, UpdateProfileProps } from '../methods/types';
import { usersCollection } from './db';
import { isDisposableEmail } from './disposableEmails';
import { consumeRateLimit } from '../rate-limit/rules';
import { sendVerificationEmail } from './verification';
import { validateEmail, validatePassword, validateProfileFields } from './validators';
import { getAuthConfig } from '@/app/authConfig';
import { resolveUniqueHandle, isDuplicateEmailError } from './utils';
import { ValidationError } from '../error';

export async function handleSignupWithPassword(
  props: Args,
  { user, session, connectionInfo }: Context
) {
  const authConfig = getAuthConfig();
  try {
    if (user) {
      throw new ValidationError('User is already authenticated', 'ALREADY_AUTHENTICATED');
    }

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

    if (!authConfig.allowDisposableEmails && (await isDisposableEmail(email))) {
      throw new Error('Please use a permanent email address');
    }

    // TODO: captcha check

    // Everything that can reject the request runs before the duplicate-email
    // check below. If any of it came after, a probe that fails it would get a
    // different error depending on whether the email is registered, which
    // would reveal the account without creating one.
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

    // Runs on every password-setting path (see `resetPassword`), so a policy
    // configured here can't be bypassed by resetting to a weaker password.
    await authConfig.validatePassword?.({
      password,
      email,
      context: 'signup',
    });

    const resolvedHandle = await resolveSignupHandle(profileFields, email);

    const existingUser = await usersCollection.findOne(
      { 'emails.address': email },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (existingUser) {
      throw new Error('Unable to create account');
    }

    await authConfig.onBeforeSignup?.({
      email,
      firstName,
      lastName,
      handle,
      provider: 'email',
      connectionInfo,
    });

    if (ip) {
      await consumeRateLimit({
        bucket: 'signup',
        type: 'ip',
        value: ip,
      });
    }

    // Hash password with bcrypt (salt is automatically generated)
    const hash = await bcrypt.hash(password, 10);

    let result;
    try {
      result = await usersCollection.insertOne({
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
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        // A concurrent signup won the race between the findOne check above and
        // this insert; the unique emails.address index rejected the duplicate.
        // Surface the same message the pre-check would have.
        throw new Error('Unable to create account');
      }
      throw error;
    }

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

async function resolveSignupHandle(
  profileFields: Partial<UpdateProfileProps>,
  email: string
): Promise<string> {
  if (profileFields.handle) {
    return resolveUniqueHandle(profileFields.handle, email);
  }

  const { generateHandle } = getAuthConfig();
  if (generateHandle) {
    const generated = await generateHandle({
      email,
      firstName: profileFields.firstName,
      lastName: profileFields.lastName,
    });

    return resolveUniqueHandle(generated, email, { throwOnConflict: false });
  }

  return resolveUniqueHandle(undefined, email);
}
