import { getConfig } from '@/server';
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getRedirectUri,
  handleOAuthUserAuthentication,
  validateOAuthCode,
  type OAuthUserData,
} from './oauth-common';

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string;
  email: string | null;
  avatar_url: string;
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<GitHubTokenResponse> {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to exchange code for token: ${tokenResponse.statusText}`);
  }

  return tokenResponse.json();
}

async function fetchGitHubUserInfo(accessToken: string): Promise<GitHubUserInfo> {
  const userInfoResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!userInfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userInfoResponse.statusText}`);
  }

  return userInfoResponse.json();
}

async function handleGitHubAuthenticationCallback(req: Request, res: Response) {
  const code = validateOAuthCode(req.query.code);

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  const githubClientId = String(getConfig('_system.user.auth.github.clientId'));
  const githubClientSecret = String(getConfig('_system.user.auth.github.clientSecret'));
  const redirectUri = getRedirectUri(req, 'github');

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(
      code,
      githubClientId,
      githubClientSecret,
      redirectUri
    );

    // Fetch user info
    const githubUser = await fetchGitHubUserInfo(tokenData.access_token);

    // Use the public email from user profile
    const githubEmail = githubUser.email || '';

    if (!githubEmail) {
      res.status(400).json({
        error:
          'Unable to retrieve email from GitHub. Please ensure your email is public or grant email permissions.',
      });
      return;
    }

    const userData: OAuthUserData = {
      id: String(githubUser.id),
      email: githubEmail,
      emailVerified: true, // Assume public email is verified
      providerName: 'github',
    };

    await handleOAuthUserAuthentication(req, res, userData);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

function getRouter() {
  const githubAuthRouter = Router();

  // Middleware to check if GitHub auth is enabled and configured
  const checkGitHubEnabled = (_req: Request, res: Response, next: NextFunction) => {
    const githubEnabled = Boolean(getConfig('_system.user.auth.github.enabled'));
    const githubClientId = String(getConfig('_system.user.auth.github.clientId'));
    const githubClientSecret = String(getConfig('_system.user.auth.github.clientSecret'));

    if (!githubEnabled || !githubClientId || !githubClientSecret) {
      res.status(503).json({ error: 'GitHub authentication is not configured' });
      return;
    }

    next();
  };

  // Initiate OAuth flow
  githubAuthRouter.get(
    '/api/_internal/auth/github',
    checkGitHubEnabled,
    (req: Request, res: Response) => {
      const githubClientId = String(getConfig('_system.user.auth.github.clientId'));
      const redirectUri = getRedirectUri(req, 'github');
      const githubScopes = getConfig('_system.user.auth.github.scopes');
      const scopes = githubScopes
        ? String(githubScopes)
            .split(',')
            .map((s) => s.trim())
            .join(' ')
        : 'user:email';

      const authUrl = new URL('https://github.com/login/oauth/authorize');
      authUrl.searchParams.append('client_id', githubClientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('scope', scopes);

      res.redirect(authUrl.toString());
    }
  );

  // Handle OAuth callback
  githubAuthRouter.get(
    '/api/_internal/auth/github/callback',
    checkGitHubEnabled,
    handleGitHubAuthenticationCallback
  );

  return githubAuthRouter;
}

export default getRouter;
