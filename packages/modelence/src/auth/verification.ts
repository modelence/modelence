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
import { getConfig } from '@/config/server';
import { createSession, setAuthTokenCookie } from './session';

const USER_COLLATION = { locale: 'en', strength: 2 } as const;

async function verifyEmailToken(token: string) {
  const tokenDoc = await emailVerificationTokensCollection.findOne({
    token,
    expiresAt: { $gt: new Date() },
  });

  if (!tokenDoc) {
    throw new Error('Invalid or expired verification token');
  }

  const userDoc = await usersCollection.findOne({
    _id: tokenDoc.userId,
    status: { $nin: ['deleted', 'disabled'] },
  });

  if (!userDoc) {
    throw new Error('User not found');
  }

  const email = tokenDoc.email;

  if (!email) {
    throw new Error('Email not found in token');
  }

  // Mark the specific email as verified atomically, returning the updated doc.
  // `$elemMatch` keeps both conditions bound to a single array element: with two
  // independent dotted predicates, `'emails.verified': { $ne: true }` means "no
  // element is verified", so any account already holding one verified address
  // could never verify another, and the positional `$` had no guarantee of
  // binding to the element carrying `address`.
  // Same strength-2 collation as the lookups: the token always carries a
  // lowercased address (validateEmail) while the stored address may keep its
  // original casing (e.g. OAuth-created accounts), or the match silently fails.
  const updatedUserDoc = await usersCollection.findOneAndUpdate(
    {
      _id: tokenDoc.userId,
      status: { $nin: ['deleted', 'disabled'] },
      emails: { $elemMatch: { address: email, verified: { $ne: true } } },
    },
    { $set: { 'emails.$.verified': true } },
    { collation: USER_COLLATION, returnDocument: 'after' }
  );

  // Consume the token regardless of the update outcome: it has now been
  // presented, and leaving it spendable until its 24h expiry lets a token that
  // always fails be replayed.
  await emailVerificationTokensCollection.deleteOne({ _id: tokenDoc._id });

  if (!updatedUserDoc) {
    // Distinguish "already verified" from "not this user's address" by checking
    // the specific element, mirroring handleResendEmailVerification. The prior
    // check only matched on address, so an address that failed to verify for any
    // other reason was still reported as already verified.
    const existingEmailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === email);

    if (!existingEmailDoc) {
      throw new Error('Email address not found for this user');
    }

    if (existingEmailDoc.verified) {
      throw new Error('Email is already verified');
    }

    throw new Error('Unable to verify email address');
  }

  return { userDoc: updatedUserDoc, email };
}

export async function handleVerifyEmail(params: RouteParams): Promise<RouteResponse> {
  const baseUrl = getConfig('_system.site.url') as string | undefined;
  const emailVerifiedRedirectUrl =
    getEmailConfig().verification?.redirectUrl ||
    getEmailConfig().emailVerifiedRedirectUrl ||
    baseUrl ||
    '/';
  try {
    const token = z.string().parse(params.query.token);
    const { userDoc } = await verifyEmailToken(token);

    const authConfig = getAuthConfig();
    authConfig.onAfterEmailVerification?.({
      provider: 'email',
      user: userDoc as User,
      session: null,
      connectionInfo: {
        baseUrl,
        ip: params.req.ip || params.req.socket.remoteAddress,
        userAgent: params.headers['user-agent'],
        acceptLanguage: params.headers['accept-language'],
        referrer: params.headers['referer'],
      },
    });

    const { authToken } = await createSession(userDoc._id);

    setAuthTokenCookie(params.res, authToken);

    return {
      status: 301,
      // Suppress the Referer so the token-bearing verification URL never leaks.
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: `${emailVerifiedRedirectUrl}?status=verified`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
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
    }

    return {
      status: 301,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: `${emailVerifiedRedirectUrl}?status=error&message=${encodeURIComponent(message)}`,
    };
  }
}

export async function sendVerificationEmail({
  userId,
  email,
  baseUrl: requestBaseUrl,
}: {
  userId: ObjectId;
  email: string;
  baseUrl?: string;
}) {
  const baseUrl = (getConfig('_system.site.url') as string | undefined) || requestBaseUrl;

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

  const emailDoc = userDoc.emails?.find((e) => e.address.toLowerCase() === email);

  if (!emailDoc || emailDoc.verified) {
    return resendVerificationResponse;
  }

  if (!getEmailConfig().provider) {
    throw new Error('Email provider is not configured');
  }

  await consumeRateLimit({
    bucket: 'verification',
    type: 'user',
    value: userDoc._id.toString(),
    message: 'Please wait at least 60 seconds before requesting another verification email',
  });

  await sendVerificationEmail({
    userId: userDoc._id,
    email,
    baseUrl: connectionInfo?.baseUrl,
  });

  return resendVerificationResponse;
}
