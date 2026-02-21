import { randomBytes } from 'crypto';

import { Module } from '../app/module';
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
import { handleSignupWithPassword } from './signup';
import { handleVerifyEmail, handleResendEmailVerification } from './verification';
import { handleResetPassword, handleSendResetPasswordToken } from './resetPassword';

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
  },
  cronJobs: {
    updateDisposableEmailList: updateDisposableEmailListCron,
  },
  rateLimits: [
    {
      bucket: 'signup',
      type: 'ip',
      window: time.minutes(15),
      limit: 20,
    },
    {
      bucket: 'signup',
      type: 'ip',
      window: time.days(1),
      limit: 200,
    },
    {
      bucket: 'signupAttempt',
      type: 'ip',
      window: time.minutes(15),
      limit: 50,
    },
    {
      bucket: 'signupAttempt',
      type: 'ip',
      window: time.days(1),
      limit: 500,
    },
    {
      bucket: 'signin',
      type: 'ip',
      window: time.minutes(15),
      limit: 50,
    },
    {
      bucket: 'signin',
      type: 'ip',
      window: time.days(1),
      limit: 500,
    },
    {
      bucket: 'verification',
      type: 'user',
      window: time.seconds(60),
      limit: 1,
    },
    {
      bucket: 'verification',
      type: 'user',
      window: time.days(1),
      limit: 10,
    },
  ],
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
