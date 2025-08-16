import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { Args, Context } from '@/methods/types';
import { usersCollection, resetPasswordTokensCollection } from './db';
import { getEmailConfig } from '@/app/emailConfig';
import { time } from '@/time';
import { htmlToText } from '@/utils';

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

export async function handleSendResetPasswordToken(args: Args, { connectionInfo }: Context) {
  const email = z.string().email().parse(args.email);

  // Find user by email
  const userDoc = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!userDoc) {
    // For security, don't reveal if email exists or not
    return { success: true, message: 'If an account with that email exists, a password reset link has been sent' };
  }

  // Check if user has password auth method
  if (!userDoc.authMethods?.password) {
    return { success: true, message: 'If an account with that email exists, a password reset link has been sent' };
  }

  const emailProvider = getEmailConfig().provider;
  if (!emailProvider) {
    throw new Error('Email provider is not configured');
  }

  // Generate reset token
  const resetToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + time.hours(1)); // 1 hour expiry

  // Store reset token
  await resetPasswordTokensCollection.insertOne({
    userId: userDoc._id,
    token: resetToken,
    createdAt: new Date(),
    expiresAt,
  });

  // Build reset URL
  const baseUrl = process.env.MODELENCE_SITE_URL || connectionInfo?.baseUrl;
  const verificationUrl = getEmailConfig().passwordReset?.redirectUrl || baseUrl;
  const resetUrl = `${verificationUrl}?token=${resetToken}`;

  // Send email
  const template = getEmailConfig()?.passwordReset?.template || defaultPasswordResetTemplate;
  const htmlTemplate = template({ email, resetUrl });
  const textContent = htmlToText(htmlTemplate);

  await emailProvider.sendEmail({
    to: email,
    from: getEmailConfig()?.from || 'noreply@modelence.com',
    subject: getEmailConfig()?.passwordReset?.subject || 'Reset your password',
    text: textContent,
    html: htmlTemplate,
  });

  return { success: true, message: 'If an account with that email exists, a password reset link has been sent' };
}

export async function handleResetPassword(args: Args, { }: Context) {
  const token = z.string().parse(args.token);
  const newPassword = z.string()
    .min(8, { message: 'Password must contain at least 8 characters' })
    .parse(args.newPassword);

  // Find the reset token
  const resetTokenDoc = await resetPasswordTokensCollection.findOne({ token });
  if (!resetTokenDoc) {
    throw new Error('Invalid or expired reset token');
  }

  // Check if token is expired
  if (resetTokenDoc.expiresAt < new Date()) {
    await resetPasswordTokensCollection.deleteOne({ token });
    throw new Error('Reset token has expired');
  }

  // Find the user
  const userDoc = await usersCollection.findOne({ _id: resetTokenDoc.userId });
  if (!userDoc) {
    throw new Error('User not found');
  }

  // Hash the new password
  const hash = await bcrypt.hash(newPassword, 10);

  // Update user's password
  await usersCollection.updateOne(
    { _id: userDoc._id },
    {
      $set: {
        'authMethods.password.hash': hash
      }
    }
  );

  // Delete the used reset token
  await resetPasswordTokensCollection.deleteOne({ token });

  return { success: true, message: 'Password has been reset successfully' };
}
