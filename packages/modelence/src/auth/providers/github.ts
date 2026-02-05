import { getConfig } from '@/server';
import { time } from '@/time';
import { randomBytes } from 'crypto';
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

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: 'public' | 'private' | null;
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

async function fetchGitHubUserEmails(accessToken: string): Promise<GitHubEmail[]> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user emails: ${response.statusText}`);
  }

  return response.json();
}

async function getGitHubUserEmail(
  githubUser: GitHubUserInfo,
  accessToken: string
): Promise<string | null> {
  if (githubUser.email) {
    return githubUser.email;
  }

  const emails = await fetchGitHubUserEmails(accessToken);
  return emails.find((e) => e.primary && e.verified)?.email ?? null;
}

async function handleGitHubAuthenticationCallback(req: Request, res: Response) {
  const code = validateOAuthCode(req.query.code);
  const state = req.query.state as string;
  const storedState = req.cookies.authStateGithub;

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  if (!state || !storedState || state !== storedState) {
    res.status(400).json({ error: 'Invalid OAuth state - possible CSRF attack' });
    return;
  }

  res.clearCookie('authStateGithub');

  const githubClientId = String(getConfig('_system.user.auth.github.clientId'));
  const githubClientSecret = String(getConfig('_system.user.auth.github.clientSecret'));
  const redirectUri = getRedirectUri('github');

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

    // Resolve a usable GitHub email (public email or fallback to primary verified email)
    const githubEmail = await getGitHubUserEmail(githubUser, tokenData.access_token);

    if (!githubEmail) {
      res.status(400).json({
        error:
          'Unable to retrieve a primary verified email from GitHub. Please ensure your GitHub account has a verified email set as primary.',
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
      const redirectUri = getRedirectUri('github');
      const githubScopes = getConfig('_system.user.auth.github.scopes');
      const scopes = githubScopes
        ? String(githubScopes)
            .split(',')
            .map((s) => s.trim())
            .join(' ')
        : 'user:email';

      const state = randomBytes(32).toString('hex');

      res.cookie('authStateGithub', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: time.minutes(10), // 10 minutes
      });

      const authUrl = new URL('https://github.com/login/oauth/authorize');
      authUrl.searchParams.append('client_id', githubClientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('state', state);

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
