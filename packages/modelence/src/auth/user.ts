import { randomBytes } from 'crypto';

import type { AuthRateLimitsConfig } from '../app/authConfig';
import { Module } from '../app/module';
import { RateLimitRule } from '../rate-limit/types';
import { time } from '../time';
import {
  dbDisposableEmailDomains,
  emailVerificationTokensCollection,
  resetPasswordTokensCollection,
  usersCollection,
} from './db';
import { updateDisposableEmailListCron } from './disposableEmails';
import { handleLoginWithPassword, handleLogout } from './login';
import { getOwnProfile, handleUpdateProfile } from './profile';
import { handleUnlinkOAuthProvider } from './unlinkOAuthProvider';
import { handleSignupWithPassword } from './signup';
import { handleVerifyEmail, handleResendEmailVerification } from './verification';
import { handleResetPassword, handleSendResetPasswordToken } from './resetPassword';

/**
 * Builds the rate limit rules for all authentication endpoints, merging any
 * caller-supplied overrides with the built-in defaults.
 *
 * Exposed so that `startApp` can pass user-configured limits at startup rather
 * than relying on static values baked into the Module constructor.
 */
export function buildAuthRateLimits(config: AuthRateLimitsConfig = {}): RateLimitRule[] {
  return [
    {
      bucket: 'signup',
      type: 'ip',
      window: time.minutes(15),
      limit: config.signup?.perIp15Minutes ?? 20,
    },
    {
      bucket: 'signup',
      type: 'ip',
      window: time.days(1),
      limit: config.signup?.perIpPerDay ?? 200,
    },
    {
      bucket: 'signupAttempt',
      type: 'ip',
      window: time.minutes(15),
      limit: config.signupAttempt?.perIp15Minutes ?? 50,
    },
    {
      bucket: 'signupAttempt',
      type: 'ip',
      window: time.days(1),
      limit: config.signupAttempt?.perIpPerDay ?? 500,
    },
    {
      bucket: 'signin',
      type: 'ip',
      window: time.minutes(15),
      limit: config.signin?.perIp15Minutes ?? 50,
    },
    {
      bucket: 'signin',
      type: 'ip',
      window: time.days(1),
      limit: config.signin?.perIpPerDay ?? 500,
    },
    {
      bucket: 'verification',
      type: 'user',
      window: time.seconds(60),
      limit: config.verification?.perUserPerMinute ?? 1,
    },
    {
      bucket: 'verification',
      type: 'user',
      window: time.days(1),
      limit: config.verification?.perUserPerDay ?? 10,
    },
    {
      bucket: 'passwordReset',
      type: 'ip',
      window: time.minutes(15),
      limit: config.passwordReset?.perIp15Minutes ?? 10,
    },
    {
      bucket: 'passwordReset',
      type: 'ip',
      window: time.days(1),
      limit: config.passwordReset?.perIpPerDay ?? 100,
    },
    {
      bucket: 'passwordReset',
      type: 'email',
      window: time.hours(1),
      limit: config.passwordReset?.perEmailPerHour ?? 5,
    },
    {
      bucket: 'passwordReset',
      type: 'email',
      window: time.days(1),
      limit: config.passwordReset?.perEmailPerDay ?? 10,
    },
  ];
}

export async function createGuestUser() {
  // TODO: add rate-limiting and captcha handling

  const guestId = randomBytes(9)
    .toString('base64')
    .replace(/[+/]/g, (c) => (c === '+' ? 'a' : 'b'));

  const handle = `guest_${guestId}`;
  // TODO: re-try on handle collision

  const result = await usersCollection.insertOne({
    handle,
    status: 'active',
    createdAt: new Date(),
    authMethods: {},
  });

  return result.insertedId;
}

export default new Module('_system.user', {
  stores: [
    usersCollection,
    dbDisposableEmailDomains,
    emailVerificationTokensCollection,
    resetPasswordTokensCollection,
  ],
  queries: {
    getOwnProfile,
  },
  mutations: {
    signupWithPassword: handleSignupWithPassword,
    loginWithPassword: handleLoginWithPassword,
    logout: handleLogout,
    resendEmailVerification: handleResendEmailVerification,
    sendResetPasswordToken: handleSendResetPasswordToken,
    resetPassword: handleResetPassword,
    updateProfile: handleUpdateProfile,
    unlinkOAuthProvider: handleUnlinkOAuthProvider,
  },
  cronJobs: {
    updateDisposableEmailList: updateDisposableEmailListCron,
  },
  configSchema: {
    'auth.email.enabled': {
      type: 'boolean',
      isPublic: true,
      default: true,
    },
    'auth.email.from': {
      type: 'string',
      isPublic: false,
      default: '',
    },
    'auth.email.verification': {
      type: 'boolean',
      isPublic: true,
      default: false,
    },
    'auth.google.enabled': {
      type: 'boolean',
      isPublic: true,
      default: false,
    },
    'auth.google.clientId': {
      type: 'string',
      isPublic: false,
      default: '',
    },
    'auth.google.clientSecret': {
      type: 'secret',
      isPublic: false,
      default: '',
    },
    'auth.github.enabled': {
      type: 'boolean',
      isPublic: true,
      default: false,
    },
    'auth.github.clientId': {
      type: 'string',
      isPublic: false,
      default: '',
    },
    'auth.github.clientSecret': {
      type: 'secret',
      isPublic: false,
      default: '',
    },
  },
  routes: [
    {
      path: '/api/_internal/auth/verify-email',
      handlers: {
        get: handleVerifyEmail,
      },
    },
  ],
});
