import { type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../db";
import { createSession } from "../session";
import { getAuthConfig } from "@/app/authConfig";
import { getCallContext } from "@/app/server";

export interface OAuthUserData {
  id: string;
  email: string;
  emailVerified: boolean;
  providerName: 'google' | 'github';
}

export async function authenticateUser(res: Response, userId: ObjectId) {
  const { authToken } = await createSession(userId);

  res.cookie("authToken", authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(301);
  res.redirect("/");
}

export function getRedirectUri(req: Request, provider: string): string {
  return `${req.protocol}://${req.get('host')}/api/_internal/auth/${provider}/callback`;
}

export async function handleOAuthUserAuthentication(
  req: Request,
  res: Response,
  userData: OAuthUserData
): Promise<void> {
  const existingUser = await usersCollection.findOne(
    { [`authMethods.${userData.providerName}.id`]: userData.id },
  );

  const {
    session,
    connectionInfo,
  } = await getCallContext(req);

  try {
    if (existingUser) {
      await authenticateUser(res, existingUser._id);

      getAuthConfig().onAfterLogin?.({
        user: existingUser,
        session,
        connectionInfo,
      });
      getAuthConfig().login?.onSuccess?.(existingUser);

      return;
    }
  } catch(error) {
    if (error instanceof Error) {
      getAuthConfig().login?.onError?.(error);

      getAuthConfig().onLoginError?.({
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }

  try {
    if (!userData.email) {
      res.status(400).json({
        error: `Email address is required for ${userData.providerName} authentication.`,
      });
      return;
    }

    const existingUserByEmail = await usersCollection.findOne(
      { 'emails.address': userData.email, },
      { collation: { locale: 'en', strength: 2 } },
    );

    // TODO: check if the email is verified
    if (existingUserByEmail) {
      // TODO: handle case with an HTML page
      res.status(400).json({
        error: "User with this email already exists. Please log in instead.",
      });
      return;
    }

    // If the user does not exist, create a new user
    const newUser = await usersCollection.insertOne({
      handle: userData.email,
      emails: [{
        address: userData.email,
        verified: userData.emailVerified,
      }],
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
      { readPreference: "primary" }
    );

    if (userDocument) {
      getAuthConfig().onAfterSignup?.({
        user: userDocument,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onSuccess?.(userDocument);
    }
  } catch(error) {
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

export function validateOAuthCode(code: unknown): string | null {
  if (!code || typeof code !== 'string') {
    return null;
  }
  return code;
}
