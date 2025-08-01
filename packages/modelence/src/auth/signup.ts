import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { Args, Context } from '../methods/types';
import { usersCollection, emailVerificationTokensCollection } from './db';
import { isDisposableEmail } from './disposableEmails';
import { consumeRateLimit } from '../rate-limit/rules';
import { getConfig } from '@/server';
import { getEmailConfig } from '@/app/emailConfig';
import { time } from '@/time';

function defaultEmailVerificationTemplate({ name, email, verificationUrl }: { name?: string; email: string; verificationUrl: string }) {
  return `
    <p>Hello${name ? ` ${name}` : ''},</p>
    <p>Please verify your email address ${email} by clicking the link below:</p>
    <p><a href="${verificationUrl}">Verify Email</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `;
}

export async function handleSignupWithPassword(args: Args, { user, connectionInfo }: Context) {
  const email = z.string().email().parse(args.email);
  const password = z.string()
    .min(8, { message: 'Password must contain at least 8 characters' })
    .parse(args.password);

  if (await isDisposableEmail(email)) {
    throw new Error('Please use a permanent email address');
  }

  // TODO: captcha check

  if (user) {
    // TODO: handle cases where a user is already logged in
  }

  const existingUser = await usersCollection.findOne(
    { 'emails.address': email },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (existingUser) {
    const existingEmail = existingUser.emails?.find(e => e.address === email);
    throw new Error(`User with email already exists: ${existingEmail?.address}`);
  }

  const ip = connectionInfo?.ip;
  if (ip) {
    await consumeRateLimit({
      bucket: 'signup',
      type: 'ip',
      value: ip,
    });
  }

  // Hash password with bcrypt (salt is automatically generated)
  const hash = await bcrypt.hash(password, 10);

  const result = await usersCollection.insertOne({
    handle: email,
    emails: [{
      address: email,
      verified: false,
    }],
    createdAt: new Date(),
    authMethods: {
      password: {
        hash,
      }
    }
  });

  if (getEmailConfig().provider) {
    const emailProvider = getEmailConfig().provider;
    const baseUrl = process.env.MODELENCE_SITE_URL || connectionInfo?.baseUrl;

    // Generate verification token
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + time.hours(24));

    // Store token in database
    await emailVerificationTokensCollection.insertOne({
      userId: result.insertedId,
      email,
      token: verificationToken,
      createdAt: new Date(),
      expiresAt,
    });
    
    const verifyUrl = `${baseUrl}/api/_internal/auth/verify-email?token=${verificationToken}`;
    
    const template = getEmailConfig()?.verification?.template || defaultEmailVerificationTemplate;
    // TODO: we should have also the name on this step
    const htmlTemplate = template({ name: '', email, verificationUrl: verifyUrl });
    const textContent = htmlTemplate.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    
    await emailProvider?.sendEmail({
      to: email,
      from: getEmailConfig()?.from || 'noreply@modelence.com',
      subject: getEmailConfig()?.verification?.subject || 'Verify your email address',
      text: textContent,
      html: htmlTemplate,
    });
  }
  

  return result.insertedId;
}
