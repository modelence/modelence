import { type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { usersCollection } from '@/auth/db';
import { createSession } from '@/auth/session';
import { getAuthConfig } from '@/app/authConfig';
import { getCallContext } from '@/app/server';
import { getConfig } from '@/config/server';
import { resolveUniqueHandle } from '../utils';
import { User, Session, UserEmail } from '@/auth/types';
import { ConnectionInfo } from '@/methods/types';

export interface OAuthUserData {
  id: string;
  email: string;
  emailVerified: boolean;
  providerName: 'google' | 'github';
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

export async function authenticateUser(res: Response, userId: ObjectId) {
  const { authToken } = await createSession(userId);

  res.cookie('authToken', authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.status(302);
  res.redirect('/');
}

async function handleExistingProviderLogin(
  res: Response,
  userData: OAuthUserData,
  existingUser: User,
  session: Session | null,
  connectionInfo: ConnectionInfo
) {
  const authConfig = getAuthConfig();

  try {
    if (existingUser.status === 'disabled' || existingUser.status === 'deleted') {
      res.status(400).json({
        error: 'User account is not active.',
      });
      return;
    }

    //Add User FirstName,LastName, AvatarURL if not exists
    const update: Partial<Pick<OAuthUserData, 'firstName' | 'lastName' | 'avatarUrl'>> = {};

    if (existingUser.firstName === undefined && userData.firstName) {
      update.firstName = userData.firstName;
    }
    if (existingUser.lastName === undefined && userData.lastName) {
      update.lastName = userData.lastName;
    }
    if (existingUser.avatarUrl === undefined && userData.avatarUrl) {
      update.avatarUrl = userData.avatarUrl;
    }

    let user = existingUser;

    if (Object.keys(update).length > 0) {
      await usersCollection.updateOne({ _id: existingUser._id }, { $set: update });
      user = { ...existingUser, ...update } as typeof existingUser;
    }

    await authenticateUser(res, existingUser._id);
    authConfig.onAfterLogin?.({
      provider: userData.providerName,
      user,
      session,
      connectionInfo,
    });
    authConfig.login?.onSuccess?.(user);
  } catch (error) {
    if (error instanceof Error) {
      authConfig.login?.onError?.(error);

      authConfig.onLoginError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }
}

async function handleExistingEmailLogin(
  res: Response,
  userData: OAuthUserData,
  existingUserByEmail: User,
  session: Session | null,
  connectionInfo: ConnectionInfo
) {
  const authConfig = getAuthConfig();
  const linkingMode = authConfig.oauthAccountLinking ?? 'manual';

  if (linkingMode === 'auto' && userData.emailVerified) {
    if (existingUserByEmail.status === 'disabled' || existingUserByEmail.status === 'deleted') {
      res.status(400).json({
        error: 'User account is not active.',
      });
      return;
    }

    const matchedEmail = existingUserByEmail.emails?.find(
      (emailDoc: UserEmail) => emailDoc.address.toLowerCase() === userData.email.toLowerCase()
    );

    // Prevent pre-registration takeover by requiring local ownership verification too.
    if (!matchedEmail?.verified) {
      res.status(400).json({
        error: 'User with this email already exists. Please log in instead.',
      });
      return;
    }

    try {
      // Build profile fields to backfill from provider data if missing
      const profileUpdate: Partial<Pick<OAuthUserData, 'firstName' | 'lastName' | 'avatarUrl'>> = {
        ...(existingUserByEmail.firstName === undefined &&
          userData.firstName && { firstName: userData.firstName }),
        ...(existingUserByEmail.lastName === undefined &&
          userData.lastName && { lastName: userData.lastName }),
        ...(existingUserByEmail.avatarUrl === undefined &&
          userData.avatarUrl && { avatarUrl: userData.avatarUrl }),
      };

      // Single atomic update — link provider + backfill profile in one round trip
      const updateResult = await usersCollection.updateOne(
        {
          _id: existingUserByEmail._id,
          status: { $nin: ['deleted', 'disabled'] },
          $or: [
            { [`authMethods.${userData.providerName}.id`]: { $exists: false } },
            { [`authMethods.${userData.providerName}.id`]: userData.id },
          ],
        },
        {
          $set: {
            [`authMethods.${userData.providerName}.id`]: userData.id,
            ...profileUpdate,
          },
        }
      );

      const autoLinkSuccessful = updateResult.matchedCount > 0;

      if (!autoLinkSuccessful) {
        // User was deleted/disabled between findOne and updateOne, or linked to a *different* ID
        res.status(400).json({
          error: 'User with this email already exists. Please log in instead.',
        });
        return;
      }

      await authenticateUser(res, existingUserByEmail._id);

      // Construct updated user in-memory to provide fresh data to callbacks
      const updatedUser: User = {
        ...existingUserByEmail,
        ...profileUpdate,
        authMethods: {
          ...existingUserByEmail.authMethods,
          [userData.providerName]: {
            id: userData.id,
          },
        },
      };

      authConfig.onAfterLogin?.({
        provider: userData.providerName,
        user: updatedUser,
        session,
        connectionInfo,
      });
      authConfig.login?.onSuccess?.(updatedUser);

      return;
    } catch (error) {
      if (error instanceof Error) {
        authConfig.login?.onError?.(error);

        authConfig.onLoginError?.({
          provider: userData.providerName,
          error,
          session,
          connectionInfo,
        });
      }
      throw error;
    }
  }

  // Manual mode (default) or unverified email — reject
  // TODO: handle case with an HTML page
  res.status(400).json({
    error: 'User with this email already exists. Please log in instead.',
  });
  return;
}

async function handleNewUserSignup(
  res: Response,
  userData: OAuthUserData,
  session: Session | null,
  connectionInfo: ConnectionInfo
) {
  const authConfig = getAuthConfig();

  try {
    let handle: string;

    if (authConfig.generateHandle) {
      const generated = await authConfig.generateHandle!({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
      });
      //Don't throw error if handle is already taken, instead add a suffix '_2', '_3', etc. to the handle
      handle = await resolveUniqueHandle(generated, userData.email, {
        throwOnConflict: false,
      });
    } else {
      handle = await resolveUniqueHandle(undefined, userData.email);
    }

    const userDoc = {
      handle: handle,
      status: 'active' as const,
      emails: [
        {
          address: userData.email,
          verified: userData.emailVerified,
        },
      ],
      createdAt: new Date(),
      authMethods: {
        [userData.providerName]: {
          id: userData.id,
        },
      },
      ...(userData.firstName !== undefined && { firstName: userData.firstName }),
      ...(userData.lastName !== undefined && { lastName: userData.lastName }),
      ...(userData.avatarUrl !== undefined && { avatarUrl: userData.avatarUrl }),
    };

    const newUser = await usersCollection.insertOne(userDoc);

    await authenticateUser(res, newUser.insertedId);

    const userDocument = await usersCollection.findOne(
      { _id: newUser.insertedId },
      { readPreference: 'primary' }
    );

    if (userDocument) {
      authConfig.onAfterSignup?.({
        provider: userData.providerName,
        user: userDocument,
        session,
        connectionInfo,
      });

      authConfig.signup?.onSuccess?.(userDocument);
    }
  } catch (error) {
    if (error instanceof Error) {
      authConfig.onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      authConfig.signup?.onError?.(error);
    }
    throw error;
  }
}

export function getRedirectUri(provider: string): string {
  return `${getConfig('_system.site.url')}/api/_internal/auth/${provider}/callback`;
}

export async function handleOAuthUserAuthentication(
  req: Request,
  res: Response,
  userData: OAuthUserData
): Promise<void> {
  // 1. Try to fetch existing user by OAuth ID
  const existingUser = await usersCollection.findOne({
    [`authMethods.${userData.providerName}.id`]: userData.id,
  });

  const { session, connectionInfo } = await getCallContext(req);

  if (existingUser) {
    return handleExistingProviderLogin(res, userData, existingUser, session, connectionInfo);
  }

  // 2. Validate Email is provided by Provider
  if (!userData.email) {
    res.status(400).json({
      error: `Email address is required for ${userData.providerName} authentication.`,
    });
    return;
  }

  // 3. Try to fetch existing user by Email
  let existingUserByEmail;

  try {
    existingUserByEmail = await usersCollection.findOne(
      { 'emails.address': userData.email, status: { $ne: 'deleted' } },
      { collation: { locale: 'en', strength: 2 } }
    );
  } catch (error) {
    if (error instanceof Error) {
      const authConfig = getAuthConfig();
      authConfig.onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      authConfig.signup?.onError?.(error);
    }
    throw error;
  }

  //User Already existed via email verification but now trying to login via OAuth Providers from the same email
  if (existingUserByEmail) {
    return handleExistingEmailLogin(res, userData, existingUserByEmail, session, connectionInfo);
  }

  //New User
  return handleNewUserSignup(res, userData, session, connectionInfo);
}

export async function handleOAuthProviderLink(
  req: Request,
  res: Response,
  userData: OAuthUserData
): Promise<void> {
  // Important: must clear temporary non-httpOnly cookie used during OAuth linking
  const clearTempAuthCookie = () => {
    res.cookie('oauth_link_token', '', {
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  };

  const authConfig = getAuthConfig();
  const { session, connectionInfo } = await getCallContext(req);

  if (!session?.userId) {
    clearTempAuthCookie();
    res.status(401).json({
      error: 'You must be signed in to link a provider.',
    });
    return;
  }

  const userId = session.userId;

  try {
    // Atomically attach the provider to the current user while preventing
    // overwriting an existing provider ID on the same user.
    // A unique index on the provider ID ensures it cannot be linked to another user.
    const providerField = `authMethods.${userData.providerName}.id`;

    const updateResult = await usersCollection.updateOne(
      {
        _id: userId,
        status: { $nin: ['deleted', 'disabled'] },
        $or: [{ [providerField]: { $exists: false } }, { [providerField]: userData.id }],
      },
      {
        $set: {
          [providerField]: userData.id,
        },
      }
    );

    // If no document matched, figure out why
    if (updateResult.matchedCount === 0) {
      const currentUser = await usersCollection.findOne({ _id: userId });

      if (!currentUser || currentUser.status === 'deleted' || currentUser.status === 'disabled') {
        clearTempAuthCookie();

        res.status(400).json({ error: 'User account is not active.' });

        authConfig.onOAuthLinkError?.({
          provider: userData.providerName,
          error: new Error('User account not found or not active'),
          session,
          connectionInfo,
        });
        return;
      }

      // Detect if the user already linked a different OAuth account
      const existingProviderId = currentUser?.authMethods?.[userData.providerName]?.id;

      if (existingProviderId && existingProviderId !== userData.id) {
        clearTempAuthCookie();

        res.status(400).json({
          error: `You have already linked a different ${userData.providerName} account.`,
        });

        authConfig.onOAuthLinkError?.({
          provider: userData.providerName,
          error: new Error(`User already has a different ${userData.providerName} account linked`),
          session,
          connectionInfo,
        });

        return;
      }

      // Fallback safety guard in case the DB state does not match any expected branch
      clearTempAuthCookie();

      res.status(400).json({
        error: `Unable to link ${userData.providerName} account.`,
      });

      authConfig.onOAuthLinkError?.({
        provider: userData.providerName,
        error: new Error(`Unexpected OAuth linking state for ${userData.providerName}`),
        session,
        connectionInfo,
      });

      return;
    }

    const updatedUser = await usersCollection.findOne({ _id: userId });

    if (updatedUser) {
      authConfig.onAfterOAuthLink?.({
        provider: userData.providerName,
        user: updatedUser,
        session,
        connectionInfo,
      });
    }

    // Redirect back to the app after successful link
    clearTempAuthCookie();

    res.status(302).redirect('/');
  } catch (error) {
    if (error instanceof Error && (error as any).code === 11000) {
      clearTempAuthCookie();

      res.status(400).json({
        error: `This ${userData.providerName} account is already linked to a different user.`,
      });

      authConfig.onOAuthLinkError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      return;
    }

    if (error instanceof Error) {
      authConfig.onOAuthLinkError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }
}

export function validateOAuthCode(code: unknown): string | null {
  if (!code || typeof code !== 'string') {
    return null;
  }
  return code;
}
