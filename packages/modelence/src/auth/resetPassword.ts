import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { Args, Context } from '@/methods/types';
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

// Short-lived httpOnly cookie carrying the reset token from the landing route to
// the `resetPassword` mutation, so it never appears on a client-rendered URL.
const RESET_PASSWORD_COOKIE = 'resetPasswordToken';

// Scope the cookie to the API surface so it's only sent on the resetPassword request.
const RESET_PASSWORD_COOKIE_PATH = '/api/_internal/';

// Attributes shared by the set and clear calls. Browsers only remove a cookie
// when the clearing Set-Cookie matches the same path/secure/sameSite/httpOnly,
// so both sites must use these identical flags or the httpOnly cookie can linger.
const RESET_PASSWORD_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // `lax` so the cookie survives the email-link navigation; `strict` can drop
  // it when the SPA is reached cross-site (some webviews).
  sameSite: 'lax',
  path: RESET_PASSWORD_COOKIE_PATH,
} as const;

/**
 * Looks up a reset token without consuming it. Only matches the hashed form:
 * tokens are stored as `hashToken(rawToken)`, and the caller must present the
 * raw token. There is deliberately no plaintext fallback — matching the raw
 * value against the stored column would let a leaked SHA-256 digest be replayed
 * as a bearer token (submit the digest, it equals the stored value), defeating
 * the point of hashing at rest. Tokens expire within 1 hour (TTL index), so no
 * migration fallback is needed for tokens issued before hashing was deployed.
 */
async function findResetTokenDoc(rawToken: string) {
  return resetPasswordTokensCollection.findOne({ token: hashToken(rawToken) });
}

/**
 * Atomically claims a reset token by `_id` — the single-use enforcement point.
 * Of concurrent requests holding the same token, exactly one gets the doc back;
 * the rest get null. Returns the deleted doc, or null if already claimed.
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

  // Store only the hash, never the raw token (defense against db leaks).
  await resetPasswordTokensCollection.insertOne({
    userId: userDoc._id,
    email,
    token: hashToken(resetToken),
    createdAt,
    expiresAt,
  });

  // Point the email at the server landing route, not the SPA page, so the raw
  // token never reaches a client-rendered URL.
  const baseUrl = (getConfig('_system.site.url') as string | undefined) || connectionInfo?.baseUrl;
  if (!baseUrl) {
    // Without a base URL we'd email a broken `undefined/...` link — fail loudly.
    throw new Error(
      'Unable to build password reset link: set _system.site.url (MODELENCE_SITE_URL)'
    );
  }
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
 * Server landing route for password reset. The email links here instead of the
 * SPA page: we validate the token, stash it in a short-lived httpOnly cookie, and
 * 302-redirect to the tokenless SPA page — so the token never reaches client JS.
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

    params.res.cookie(RESET_PASSWORD_COOKIE, token, {
      ...RESET_PASSWORD_COOKIE_OPTIONS,
      maxAge: time.hours(1),
    });

    return {
      status: 302,
      // Suppress the Referer so the token-bearing landing URL never leaks.
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: resetPasswordUrl,
    };
  } catch (error) {
    // Surface a fixed, friendly message; never forward the raw error (ZodError or
    // DB error) into the redirect URL. Log the real cause server-side instead.
    console.error('Error handling password reset landing:', error);
    const message = 'This password reset link is invalid or has expired.';
    return {
      status: 302,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: `${resetPasswordUrl}?status=error&message=${encodeURIComponent(message)}`,
    };
  }
}

export async function handleResetPassword(args: Args, context: Context) {
  // Prefer the token from the httpOnly cookie set by the landing route.
  // `req` is null for in-process invocations (no cookie to read).
  const cookieToken = context.req?.cookies?.[RESET_PASSWORD_COOKIE];

  // DEPRECATED fallback: token from request args, for older clients that submit it
  // directly. Reintroduces the leak risk the cookie exchange closes — rollout only.
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
    // `res` is null for in-process invocations (no response to mutate).
    // Clear with the same flags used to set it; browsers ignore a clear whose
    // attributes don't match, which would leave the httpOnly cookie behind.
    context.res?.clearCookie(RESET_PASSWORD_COOKIE, RESET_PASSWORD_COOKIE_OPTIONS);
  };

  // Look up WITHOUT consuming: if validation/hashing fails (or the user is
  // missing), the link stays valid so the user can retry the same link.
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

  // Token already consumed at the commit point; just drop the cookie.
  clearCookie();

  return { success: true, message: 'Password has been reset successfully' };
}
