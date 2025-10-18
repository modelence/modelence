import { getConfig } from '@/server';
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getRedirectUri,
  handleOAuthUserAuthentication,
  validateOAuthCode,
  type OAuthUserData,
} from './oauth-common';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string;
}

interface GoogleUserInfo {
  id: string;
  name: string;
  email: string;
  verified_email: boolean;
  picture: string;
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
  const code = validateOAuthCode(req.query.code);

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
  const googleClientSecret = String(getConfig('_system.user.auth.google.clientSecret'));
  const redirectUri = getRedirectUri(req, 'google');

  try {
    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(
      code,
      googleClientId,
      googleClientSecret,
      redirectUri
    );

    // Fetch user info
    const googleUser = await fetchGoogleUserInfo(tokenData.access_token);

    const userData: OAuthUserData = {
      id: googleUser.id,
      email: googleUser.email,
      emailVerified: googleUser.verified_email,
      providerName: 'google',
    };

    await handleOAuthUserAuthentication(req, res, userData);
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
  googleAuthRouter.get(
    '/api/_internal/auth/google',
    checkGoogleEnabled,
    (req: Request, res: Response) => {
      const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
      const redirectUri = getRedirectUri(req, 'google');

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', googleClientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', 'profile email');
      authUrl.searchParams.append('access_type', 'online');

      res.redirect(authUrl.toString());
    }
  );

  // Handle OAuth callback
  googleAuthRouter.get(
    '/api/_internal/auth/google/callback',
    checkGoogleEnabled,
    handleGoogleAuthenticationCallback
  );

  return googleAuthRouter;
}

export default getRouter;
