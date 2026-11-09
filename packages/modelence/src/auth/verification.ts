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
import { hashToken } from './tokenHash';
import { setQueryParams, fireAuthHook } from './utils';

const USER_COLLATION = { locale: 'en', strength: 2 } as const;

const INVALID_TOKEN_MESSAGE = 'Invalid or expired verification token';

async function findVerificationTokenDoc(rawToken: string) {
  const expiresAt = { $gt: new Date() };
  const tokenDoc = await emailVerificationTokensCollection.findOne({
    token: hashToken(rawToken),
    expiresAt,
  });
  if (tokenDoc) {
    return tokenDoc;
  }

  // Legacy fallback for links emailed before tokens were hashed. Raw tokens and
  // their hashes are both 64 hex chars, so the marker filter is what stops a
  // hash copied from the db from matching its own doc. Remove once no unmarked
  // docs remain (tokens expire 24h after issue).
  return emailVerificationTokensCollection.findOne({
    token: rawToken,
    hashed: { $ne: true },
    expiresAt,
  });
}

function findActiveUser(userId: ObjectId) {
  return usersCollection.findOne({
    _id: userId,
    status: { $nin: ['deleted', 'disabled'] },
  });
}

// Tokens always carry a lowercased address, while the stored one may keep its
// original casing (e.g. OAuth-created accounts).
function findEmailDoc(user: { emails?: { address: string; verified?: boolean }[] }, email: string) {
  return user.emails?.find((e) => e.address.toLowerCase() === email);
}

async function verifyEmailToken(token: string) {
  const tokenDoc = await findVerificationTokenDoc(token);

  if (!tokenDoc) {
    throw new Error(INVALID_TOKEN_MESSAGE);
  }

  const userDoc = await findActiveUser(tokenDoc.userId);

  if (!userDoc) {
    throw new Error('User not found');
  }

  const email = tokenDoc.email;

  if (!email) {
    throw new Error('Email not found in token');
  }

  if (tokenDoc.usedAt) {
    // Already spent, usually by a mail scanner that opened the link before the
    // user did. Opening it again only reports the outcome: nothing changes and
    // no hooks fire.
    if (findEmailDoc(userDoc, email)?.verified) {
      return { userDoc, email, alreadyVerified: true };
    }
    throw new Error(INVALID_TOKEN_MESSAGE);
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
  // always fails be replayed. Marked rather than deleted, so a repeat open of
  // a successful link can still report success (see `usedAt` above).
  await emailVerificationTokensCollection.updateOne(
    { _id: tokenDoc._id },
    { $set: { usedAt: new Date() } }
  );

  if (!updatedUserDoc) {
    // Distinguish "already verified" from "not this user's address" by checking
    // the specific element, mirroring handleResendEmailVerification. The prior
    // check only matched on address, so an address that failed to verify for any
    // other reason was still reported as already verified.
    const existingEmailDoc = findEmailDoc(userDoc, email);

    if (!existingEmailDoc) {
      throw new Error('Email address not found for this user');
    }

    // Already verified when read: a concurrent open of this link (e.g. a mail
    // scanner) verified it after we read the token unused, or another link did
    // earlier. Either way the address is verified, so report that rather than
    // an error. The open that verified it fires the hooks; this one doesn't.
    if (existingEmailDoc.verified) {
      return { userDoc, email, alreadyVerified: true };
    }

    // Unverified when read, yet the update matched nothing: a concurrent open
    // may have verified it in between.
    const currentUserDoc = await findActiveUser(tokenDoc.userId);
    if (currentUserDoc && findEmailDoc(currentUserDoc, email)?.verified) {
      return { userDoc: currentUserDoc, email, alreadyVerified: true };
    }

    throw new Error('Unable to verify email address');
  }

  return { userDoc: updatedUserDoc, email, alreadyVerified: false };
}

export async function handleVerifyEmailMutation(args: Args, { connectionInfo }: Context) {
  const authConfig = getAuthConfig();

  try {
    const token = z.string().min(1).parse(args.token);
    const { userDoc, alreadyVerified } = await verifyEmailToken(token);
    if (alreadyVerified) {
      return;
    }

    fireAuthHook('onAfterEmailVerification', () =>
      authConfig.onAfterEmailVerification?.({
        provider: 'email',
        user: userDoc as User,
        session: null,
        connectionInfo,
      })
    );
  } catch (error) {
    if (error instanceof Error) {
      fireAuthHook('onEmailVerificationError', () =>
        authConfig.onEmailVerificationError?.({
          provider: 'email',
          error,
          session: null,
          connectionInfo,
        })
      );
    }
    throw error;
  }
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
    const { userDoc, alreadyVerified } = await verifyEmailToken(token);

    const authConfig = getAuthConfig();
    if (!alreadyVerified) {
      fireAuthHook('onAfterEmailVerification', () =>
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
        })
      );
    }

    // No session here: this is a GET that mail scanners open before the user
    // does, and a forwarded or logged link must not sign its holder in. The
    // app's redirect page sends the user to sign in.
    return {
      status: 302,
      // Suppress the Referer so the token-bearing verification URL never leaks.
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: setQueryParams(emailVerifiedRedirectUrl, { status: 'verified' }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (error instanceof Error) {
      const authConfig = getAuthConfig();
      fireAuthHook('onEmailVerificationError', () =>
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
        })
      );
      console.error('Error verifying email:', error);
    }

    return {
      status: 302,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: setQueryParams(emailVerifiedRedirectUrl, { status: 'error', message }),
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

    // Store only the hash: the raw token goes out in the email link alone
    await emailVerificationTokensCollection.insertOne({
      userId,
      email,
      token: hashToken(verificationToken),
      hashed: true,
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

  // Consumed before the lookup so every request counts the same, whether or
  // not the address is registered.
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
