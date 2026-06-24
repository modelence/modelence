import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { Args, Context, HttpContext } from '@/methods/types';
import { ObjectId, RouteParams, RouteResponse } from '@/server';
import { usersCollection, resetPasswordTokensCollection } from './db';
import { getEmailConfig } from '@/app/emailConfig';
import { time } from '@/time';
import { htmlToText } from '@/utils';
import { validateEmail, validatePassword } from './validators';
import { consumeRateLimit } from '@/server';
import { getConfig } from '@/config/server';
import { invalidateAllUserSessions } from './session';
import { hashToken } from './tokenHash';

/**
 * Name of the short-lived, httpOnly cookie that carries the reset token from the
 * server landing route to the `resetPassword` mutation. The token never appears
 * on a client-rendered (SPA) URL, so analytics/ad scripts cannot read it from
 * `location.href`.
 */
const RESET_PASSWORD_COOKIE = 'resetPasswordToken';

/**
 * Scope the cookie to the API surface so it is only ever sent on the
 * `resetPassword` mutation request, never on SPA navigations.
 */
const RESET_PASSWORD_COOKIE_PATH = '/api/_internal/';

/**
 * Looks up a reset token without consuming it, accepting either the
 * hashed-at-rest form (new tokens) or a legacy plaintext match (tokens emailed
 * before hashing was introduced). Used by the landing route, which validates the
 * token but must not consume it (no new password has been submitted yet).
 *
 * The plaintext fallback can be removed once one max-TTL window (1 hour) has
 * elapsed after deploying token hashing.
 */
async function findResetTokenDoc(rawToken: string) {
  const hashedDoc = await resetPasswordTokensCollection.findOne({ token: hashToken(rawToken) });
  if (hashedDoc) {
    return hashedDoc;
  }
  return resetPasswordTokensCollection.findOne({ token: rawToken });
}

/**
 * Atomically claims a previously-found reset token by `_id`. This is the
 * single-use enforcement point: of any concurrent requests holding the same
 * token, exactly one `findOneAndDelete` returns the doc and the rest get null.
 *
 * It is called only AFTER the token has been validated and the new password
 * hashed, so a failure earlier in the flow never consumes the token (the user
 * can retry the same link). Returns the deleted doc, or null if another request
 * already claimed it.
 */
async function claimResetTokenById(id: ObjectId) {
  return resetPasswordTokensCollection.findOneAndDelete({ _id: id });
}

function resolveUrl(baseUrl: string, configuredUrl?: string): string {
  if (!configuredUrl) {
    return baseUrl;
  }

  if (configuredUrl.startsWith('http://') || configuredUrl.startsWith('https://')) {
    return configuredUrl;
  }

  // Handle relative URL
  return `${baseUrl}${configuredUrl.startsWith('/') ? '' : '/'}${configuredUrl}`;
}

function defaultPasswordResetTemplate({ email, resetUrl }: { email: string; resetUrl: string }) {
  return `
    <p>Hi,</p>
    <p>We received a request to reset your password for ${email}.</p>
    <p>Click the link below to reset your password:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>This link will expire in 1 hour.</p>
    <p>If you did not request this password reset, please ignore this email.</p>
  `;
}

const passwordResetSent = {
  success: true,
  message: 'If an account with that email exists, a password reset link has been sent',
};

export async function handleSendResetPasswordToken(args: Args, { connectionInfo }: Context) {
  const email = validateEmail(args.email as string);
  const ip = connectionInfo?.ip;

  if (ip) {
    await consumeRateLimit({
      bucket: 'passwordReset',
      type: 'ip',
      value: ip,
    });
  }

  await consumeRateLimit({
    bucket: 'passwordReset',
    type: 'email',
    value: email,
  });

  // Find user by email
  const userDoc = await usersCollection.findOne(
    { 'emails.address': email, status: { $nin: ['deleted', 'disabled'] } },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!userDoc) {
    // For security, don't reveal if email exists or not
    return passwordResetSent;
  }

  // Check if user has password auth method
  if (!userDoc.authMethods?.password) {
    return passwordResetSent;
  }

  const emailProvider = getEmailConfig().provider;
  if (!emailProvider) {
    throw new Error('Email provider is not configured');
  }

  // Generate reset token
  const resetToken = randomBytes(32).toString('hex');
  const now = Date.now();
  const createdAt = new Date(now);
  const expiresAt = new Date(now + time.hours(1)); // 1 hour expiry

  // Store only the hash of the token, never the raw value (defense against db leaks)
  await resetPasswordTokensCollection.insertOne({
    userId: userDoc._id,
    email,
    token: hashToken(resetToken),
    createdAt,
    expiresAt,
  });

  // Point the email at the server-side landing route rather than the SPA page.
  // The landing route validates the token, moves it into an httpOnly cookie, and
  // redirects to the tokenless SPA page — so the raw token never reaches a
  // client-rendered URL where analytics/ad scripts could read it.
  const baseUrl = (getConfig('_system.site.url') as string | undefined) || connectionInfo?.baseUrl;
  const resetUrl = `${baseUrl}/api/_internal/auth/reset-password?token=${resetToken}`;

  // Send email
  const template = getEmailConfig()?.passwordReset?.template || defaultPasswordResetTemplate;
  const htmlTemplate = template({ email, resetUrl, name: '' });
  const textContent = htmlToText(htmlTemplate);

  await emailProvider.sendEmail({
    to: email,
    from: getEmailConfig()?.from || 'noreply@modelence.com',
    subject: getEmailConfig()?.passwordReset?.subject || 'Reset your password',
    text: textContent,
    html: htmlTemplate,
  });

  return passwordResetSent;
}

/**
 * Server landing route for password reset.
 *
 * The reset email links here (a server route that runs before the SPA catch-all)
 * instead of directly to the SPA page. We validate the token, stash it in a
 * short-lived httpOnly cookie, and 302-redirect to the tokenless SPA page where
 * the user enters a new password. The token is never exposed to client-side JS,
 * closing the leak where analytics/ad scripts read it from `location.href`.
 */
export async function handleResetPasswordLanding(params: RouteParams): Promise<RouteResponse> {
  const baseUrl =
    (getConfig('_system.site.url') as string | undefined) ||
    `${params.req.protocol}://${params.req.get('host')}`;
  const resetPasswordUrl = resolveUrl(baseUrl, getEmailConfig().passwordReset?.redirectUrl);

  try {
    const token = z.string().parse(params.query.token);

    const resetTokenDoc = await findResetTokenDoc(token);
    if (!resetTokenDoc || resetTokenDoc.expiresAt < new Date()) {
      throw new Error('This password reset link is invalid or has expired.');
    }

    // Hand the token to the SPA via an httpOnly cookie scoped to the API path,
    // so it is only ever sent back on the resetPassword mutation request.
    params.res.cookie(RESET_PASSWORD_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: RESET_PASSWORD_COOKIE_PATH,
      maxAge: time.hours(1),
    });

    return {
      status: 302,
      // Suppress the Referer so the token-bearing landing URL never leaks via the
      // Referer header on any request that follows this navigation.
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: resetPasswordUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'This password reset link is invalid or has expired.';
    return {
      status: 302,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: `${resetPasswordUrl}?status=error&message=${encodeURIComponent(message)}`,
    };
  }
}

export async function handleResetPassword(args: Args, context: Context | HttpContext) {
  // Prefer the token from the httpOnly cookie set by the landing route.
  const cookieToken = 'req' in context ? context.req?.cookies?.[RESET_PASSWORD_COOKIE] : undefined;

  // DEPRECATED fallback: accept the token from the request body for older clients
  // that submit it directly. This reintroduces the URL/body-leak risk the cookie
  // exchange was designed to eliminate, so it is intended only for the rollout
  // window and should be removed once all clients link via the landing route.
  // TODO(reset-token-arg-fallback): remove the `args.token` path.
  if (!cookieToken && args.token) {
    console.warn(
      '[modelence] resetPassword received a token via request args instead of the httpOnly ' +
        'cookie. This path is deprecated and will be removed; ensure password reset emails link ' +
        'to /api/_internal/auth/reset-password so the token is exchanged server-side.'
    );
  }

  const token = z.string().parse(cookieToken ?? args.token);
  const password = validatePassword(args.password as string);

  const clearCookie = () => {
    if ('res' in context) {
      context.res?.clearCookie(RESET_PASSWORD_COOKIE, { path: RESET_PASSWORD_COOKIE_PATH });
    }
  };

  // Look up the token WITHOUT consuming it. Validation and password hashing must
  // not burn the token: if any of them fail (or the user is missing), the link
  // stays valid so the user can simply retry instead of requesting a new email.
  const resetTokenDoc = await findResetTokenDoc(token);
  if (!resetTokenDoc) {
    clearCookie();
    throw new Error('Invalid or expired reset token');
  }

  if (resetTokenDoc.expiresAt < new Date()) {
    // Expired: remove it and reject.
    await claimResetTokenById(resetTokenDoc._id as ObjectId);
    clearCookie();
    throw new Error('Reset token has expired');
  }

  // Find the user
  const userDoc = await usersCollection.findOne({ _id: resetTokenDoc.userId });
  if (!userDoc) {
    throw new Error('User not found');
  }

  // Hash the new password
  const hash = await bcrypt.hash(password, 10);

  // Commit point: atomically claim the token. If a concurrent request already
  // consumed it, abort WITHOUT touching the password (single-use, no double-spend).
  const claimedToken = await claimResetTokenById(resetTokenDoc._id as ObjectId);
  if (!claimedToken) {
    clearCookie();
    throw new Error('Invalid or expired reset token');
  }

  // Update user's password
  await usersCollection.updateOne(
    { _id: userDoc._id },
    { $set: { 'authMethods.password.hash': hash } }
  );

  // Mark the email as verified since the user proved ownership via the reset token
  if (resetTokenDoc.email) {
    await usersCollection.updateOne(
      { _id: userDoc._id, 'emails.address': resetTokenDoc.email },
      { $set: { 'emails.$.verified': true } }
    );
  }

  // Invalidate all existing sessions for this user so that other browsers/devices
  // are forced to re-authenticate with the new password
  await invalidateAllUserSessions(userDoc._id);

  // The token was consumed atomically at the commit point above (single-use).
  // Drop the short-lived reset cookie now that the flow has completed.
  clearCookie();

  return { success: true, message: 'Password has been reset successfully' };
}
