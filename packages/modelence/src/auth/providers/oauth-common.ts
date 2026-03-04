import { type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { usersCollection } from '@/auth/db';
import { createSession } from '@/auth/session';
import { getAuthConfig } from '@/app/authConfig';
import { getCallContext } from '@/app/server';
import { getConfig } from '@/config/server';
import { User, Session, UserEmail } from '@/auth/types';
import { ConnectionInfo } from '@/methods/types';

export interface OAuthUserData {
  id: string;
  email: string;
  emailVerified: boolean;
  providerName: 'google' | 'github';
}

export async function authenticateUser(res: Response, userId: ObjectId) {
  const { authToken } = await createSession(userId);

  res.cookie('authToken', authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.status(301);
  res.redirect('/');
}

async function handleExistingProviderLogin(
  res: Response,
  userData: OAuthUserData,
  existingUser: User,
  session: Session | null,
  connectionInfo: ConnectionInfo
) {
  try {
    if (existingUser.status === 'disabled' || existingUser.status === 'deleted') {
      res.status(400).json({
        error: 'User account is not active.',
      });
      return;
    }

    await authenticateUser(res, existingUser._id);

    getAuthConfig().onAfterLogin?.({
      provider: userData.providerName,
      user: existingUser,
      session,
      connectionInfo,
    });
    getAuthConfig().login?.onSuccess?.(existingUser);
  } catch (error) {
    if (error instanceof Error) {
      getAuthConfig().login?.onError?.(error);

      getAuthConfig().onLoginError?.({
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
  if (existingUserByEmail.status === 'disabled' || existingUserByEmail.status === 'deleted') {
    res.status(400).json({
      error: 'User account is not active.',
    });
    return;
  }

  const linkingMode = getAuthConfig().oauthAccountLinking ?? 'manual';
  const matchedEmail = existingUserByEmail.emails?.find(
    (emailDoc: UserEmail) => emailDoc.address.toLowerCase() === userData.email.toLowerCase()
  );

  if (linkingMode === 'auto' && userData.emailVerified) {
    // Prevent pre-registration takeover by requiring local ownership verification too.
    if (!matchedEmail?.verified) {
      res.status(400).json({
        error: 'User with this email already exists. Please log in instead.',
      });
      return;
    }

    try {
      const updateResult = await usersCollection.updateOne(
        {
          _id: existingUserByEmail._id,
          status: { $nin: ['deleted', 'disabled'] },
          $or: [
            { [`authMethods.${userData.providerName}.id`]: { $exists: false } },
            { [`authMethods.${userData.providerName}.id`]: userData.id },
          ],
        },
        { $set: { [`authMethods.${userData.providerName}.id`]: userData.id } }
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
        authMethods: {
          ...existingUserByEmail.authMethods,
          [userData.providerName]: {
            id: userData.id,
          },
        },
      };

      getAuthConfig().onAfterLogin?.({
        provider: userData.providerName,
        user: updatedUser,
        session,
        connectionInfo,
      });
      getAuthConfig().login?.onSuccess?.(updatedUser);

      return;
    } catch (error) {
      if (error instanceof Error) {
        getAuthConfig().login?.onError?.(error);

        getAuthConfig().onLoginError?.({
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
  try {
    const newUser = await usersCollection.insertOne({
      handle: userData.email,
      status: 'active',
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
    });

    await authenticateUser(res, newUser.insertedId);

    const userDocument = await usersCollection.findOne(
      { _id: newUser.insertedId },
      { readPreference: 'primary' }
    );

    if (userDocument) {
      getAuthConfig().onAfterSignup?.({
        provider: userData.providerName,
        user: userDocument,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onSuccess?.(userDocument);
    }
  } catch (error) {
    if (error instanceof Error) {
      getAuthConfig().onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onError?.(error);
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
      getAuthConfig().onSignupError?.({
        provider: userData.providerName,
        error,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onError?.(error);
    }
    throw error;
  }

  if (existingUserByEmail) {
    return handleExistingEmailLogin(res, userData, existingUserByEmail, session, connectionInfo);
  }

  return handleNewUserSignup(res, userData, session, connectionInfo);
}

export function validateOAuthCode(code: unknown): string | null {
  if (!code || typeof code !== 'string') {
    return null;
  }
  return code;
}
