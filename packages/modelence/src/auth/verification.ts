import { z } from 'zod';

import { usersCollection, emailVerificationTokensCollection } from './db';
import { ObjectId, RouteParams, RouteResponse } from '@/server';
import { getEmailConfig } from '@/app/emailConfig';
import { randomBytes } from 'crypto';
import { time } from '@/time';
import { htmlToText } from '@/utils';
import { emailVerificationTemplate } from './templates/emailVerficationTemplate';
import { getAuthConfig } from '@/app/authConfig';
import { User } from './types';
import { Args, Context } from '@/methods/types';
import { validateEmail } from './validators';
import { consumeRateLimit } from '@/rate-limit/rules';

export async function handleVerifyEmail(params: RouteParams): Promise<RouteResponse> {
  const baseUrl = process.env.MODELENCE_SITE_URL;
  const emailVerifiedRedirectUrl = getEmailConfig().emailVerifiedRedirectUrl || baseUrl || '/';
  try {
    const token = z.string().parse(params.query.token);
    // Find token in database
    const tokenDoc = await emailVerificationTokensCollection.findOne({
      token,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      throw new Error('Invalid or expired verification token');
    }

    // Find user by token's userId
    const userDoc = await usersCollection.findOne({ _id: tokenDoc.userId });

    if (!userDoc) {
      throw new Error('User not found');
    }

    const email = tokenDoc.email;

    if (!email) {
      throw new Error('Email not found in token');
    }

    // Mark the specific email as verified atomically
    const updateResult = await usersCollection.updateOne(
      {
        _id: tokenDoc.userId,
        'emails.address': email,
        'emails.verified': { $ne: true },
      },
      { $set: { 'emails.$.verified': true } }
    );

    if (updateResult.matchedCount === 0) {
      // Check if email exists but is already verified
      const existingUser = await usersCollection.findOne({
        _id: tokenDoc.userId,
        'emails.address': email,
      });

      if (existingUser) {
        throw new Error('Email is already verified');
      } else {
        throw new Error('Email address not found for this user');
      }
    }

    // Delete the used token
    await emailVerificationTokensCollection.deleteOne({ _id: tokenDoc._id });

    const authConfig = getAuthConfig();
    authConfig.onAfterEmailVerification?.({
      provider: 'email',
      user: (await usersCollection.findOne({ 'emails.address': tokenDoc?.email })) as User,
      session: null,
      connectionInfo: {
        baseUrl,
        ip: params.req.ip || params.req.socket.remoteAddress,
        userAgent: params.headers['user-agent'],
        acceptLanguage: params.headers['accept-language'],
        referrer: params.headers['referer'],
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      const authConfig = getAuthConfig();
      authConfig.onEmailVerificationError?.({
        provider: 'email',
        error,
        session: null,
        connectionInfo: {
          baseUrl,
          ip: params.req.ip || params.req.socket.remoteAddress,
          userAgent: params.headers['user-agent'],
          acceptLanguage: params.headers['accept-language'],
          referrer: params.headers['referer'],
        },
      });
      console.error('Error verifying email:', error);

      return {
        status: 301,
        redirect: `${emailVerifiedRedirectUrl}?status=error&message=${encodeURIComponent(error.message)}`,
      };
    }
  }

  return {
    status: 301,
    redirect: `${emailVerifiedRedirectUrl}?status=verified`,
  };
}

export async function sendVerificationEmail({
  userId,
  email,
  baseUrl = process.env.MODELENCE_SITE_URL,
}: {
  userId: ObjectId;
  email: string;
  baseUrl?: string;
}) {
  if (getEmailConfig().provider) {
    const emailProvider = getEmailConfig().provider;

    // Generate verification token
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + time.hours(24));

    // Store token in database
    await emailVerificationTokensCollection.insertOne({
      userId,
      email,
      token: verificationToken,
      createdAt: new Date(),
      expiresAt,
    });

    const verificationUrl = `${baseUrl}/api/_internal/auth/verify-email?token=${verificationToken}`;

    const template = getEmailConfig()?.verification?.template || emailVerificationTemplate;
    // TODO: we should have also the name on this step
    const htmlTemplate = template({ name: '', email, verificationUrl });
    const textContent = htmlToText(htmlTemplate);

    await emailProvider?.sendEmail({
      to: email,
      from: getEmailConfig()?.from || 'noreply@modelence.com',
      subject: getEmailConfig()?.verification?.subject || 'Verify your email address',
      text: textContent,
      html: htmlTemplate,
    });
  }
}

const resendVerificationResponse = {
  success: true,
  message: 'If that email is registered and not yet verified, a verification email has been sent',
};

export async function handleResendEmailVerification(args: Args, { connectionInfo }: Context) {
  const email = validateEmail(args.email as string);

  const ip = connectionInfo?.ip;
  if (ip) {
    await consumeRateLimit({
      bucket: 'verification',
      type: 'ip',
      value: ip,
    });
  }

  // Find user by email, excluding deleted/disabled accounts
  const userDoc = await usersCollection.findOne(
    { 'emails.address': email, status: { $nin: ['deleted', 'disabled'] } },
    { collation: { locale: 'en', strength: 2 } }
  );

  // Return the same generic response whether the email is unknown,
  // already verified, or successfully sent — to prevent user enumeration.
  if (!userDoc) {
    return resendVerificationResponse;
  }

  const emailDoc = userDoc.emails?.find((e) => e.address === email);

  if (!emailDoc || emailDoc.verified) {
    return resendVerificationResponse;
  }

  if (!getEmailConfig().provider) {
    throw new Error('Email provider is not configured');
  }

  await sendVerificationEmail({
    userId: userDoc._id,
    email,
    baseUrl: connectionInfo?.baseUrl,
  });

  return resendVerificationResponse;
}
