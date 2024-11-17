import { randomBytes } from 'crypto';

export function fetchSessionByToken(authToken?: string) {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days

  if (!authToken) {
    // New guest session
    const newAuthToken = randomBytes(32).toString('base64url');

    // TODO: create guest user
    // TODO: add rate-limiting and captcha handling

    return {
      authToken: newAuthToken,
      expiresAt
    };
  }

  // TODO: validate token

  return {
    authToken,
    expiresAt
  }
}
