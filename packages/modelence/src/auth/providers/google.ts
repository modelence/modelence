import { getConfig } from "@/server";
import { Router, type Request, type Response, type NextFunction } from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../db";
import { createSession } from "../session";
import { getAuthConfig } from "@/app/authConfig";
import { getCallContext } from "@/app/server";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string;
}

interface GoogleUserInfo {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: string;
}

async function authenticateUser(res: Response, userId: ObjectId) {
  const { authToken } = await createSession(userId);

  res.cookie("authToken", authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(301);
  res.redirect("/");
}


async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to exchange code for token: ${tokenResponse.statusText}`);
  }

  return tokenResponse.json();
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userInfoResponse.statusText}`);
  }

  return userInfoResponse.json();
}

async function handleGoogleAuthenticationCallback(req: Request, res: Response) {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
  const googleClientSecret = String(getConfig('_system.user.auth.google.clientSecret'));
  const redirectUri = `${req.protocol}://${req.get('host')}/api/_internal/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(code, googleClientId, googleClientSecret, redirectUri);

    // Fetch user info
    const googleUser = await fetchGoogleUserInfo(tokenData.access_token);

    const existingUser = await usersCollection.findOne(
      { 'authMethods.google.id': googleUser.sub },
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
      const googleEmail = googleUser.email;

      if (!googleEmail) {
        res.status(400).json({
          error: "Email address is required for Google authentication.",
        });
        return;
      }

      const existingUserByEmail = await usersCollection.findOne(
        { 'emails.address': googleEmail, },
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
        handle: googleEmail,
        emails: [{
          address: googleEmail,
          verified: googleUser.email_verified,
        }],
        createdAt: new Date(),
        authMethods: {
          google: {
            id: googleUser.sub,
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
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

function getRouter() {
  const googleAuthRouter = Router();

  // Middleware to check if Google auth is enabled and configured
  const checkGoogleEnabled = (_req: Request, res: Response, next: NextFunction) => {
    const googleEnabled = Boolean(getConfig('_system.user.auth.google.enabled'));
    const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
    const googleClientSecret = String(getConfig('_system.user.auth.google.clientSecret'));

    if (!googleEnabled || !googleClientId || !googleClientSecret) {
      res.status(503).json({ error: 'Google authentication is not configured' });
      return;
    }

    next();
  };

  // Initiate OAuth flow
  googleAuthRouter.get("/api/_internal/auth/google", checkGoogleEnabled, (req: Request, res: Response) => {
    const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
    const redirectUri = `${req.protocol}://${req.get('host')}/api/_internal/auth/google/callback`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', googleClientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'profile email');
    authUrl.searchParams.append('access_type', 'online');

    res.redirect(authUrl.toString());
  });

  // Handle OAuth callback
  googleAuthRouter.get(
    "/api/_internal/auth/google/callback",
    checkGoogleEnabled,
    handleGoogleAuthenticationCallback,
  );

  return googleAuthRouter;
}

export default getRouter;
