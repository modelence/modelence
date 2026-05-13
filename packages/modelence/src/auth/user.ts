import { randomBytes } from 'crypto';

import type {
  AuthRateLimitOverride,
  InternalAuthRateLimitsConfig,
  LegacyPasswordResetRateLimits,
  LegacySigninRateLimits,
  LegacySignupAttemptRateLimits,
  LegacySignupRateLimits,
  LegacyVerificationRateLimits,
} from '../app/authConfig';
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
let warnedLegacyRateLimits = false;

function warnLegacyRateLimits(bucket: string) {
  if (warnedLegacyRateLimits) return;
  warnedLegacyRateLimits = true;
  console.warn(
    `[modelence] auth.rateLimits.${bucket}: the legacy object form (e.g. { perIp15Minutes, perIpPerDay }) is deprecated and will be removed in 1.0.0. ` +
      `Use the array form: [{ type: 'ip', window: time.minutes(15), limit: 10 }, ...].`
  );
}

function resolveBucket<TLegacy>(
  bucket: string,
  override: AuthRateLimitOverride[] | TLegacy | undefined,
  fromLegacy: (legacy: TLegacy | undefined) => RateLimitRule[]
): RateLimitRule[] {
  if (Array.isArray(override)) {
    return override.map((rule) => ({ bucket, ...rule }));
  }
  if (override !== undefined) {
    // Remove in 1.0.0 — legacy object shape no longer supported.
    warnLegacyRateLimits(bucket);
  }
  return fromLegacy(override);
}

export function buildAuthRateLimits(config: InternalAuthRateLimitsConfig = {}): RateLimitRule[] {
  return [
    ...resolveBucket<LegacySignupRateLimits>('signup', config.signup, (legacy) => [
      {
        bucket: 'signup',
        type: 'ip',
        window: time.minutes(15),
        limit: legacy?.perIp15Minutes ?? 20,
      },
      {
        bucket: 'signup',
        type: 'ip',
        window: time.days(1),
        limit: legacy?.perIpPerDay ?? 200,
      },
    ]),
    ...resolveBucket<LegacySignupAttemptRateLimits>(
      'signupAttempt',
      config.signupAttempt,
      (legacy) => [
        {
          bucket: 'signupAttempt',
          type: 'ip',
          window: time.minutes(15),
          limit: legacy?.perIp15Minutes ?? 50,
        },
        {
          bucket: 'signupAttempt',
          type: 'ip',
          window: time.days(1),
          limit: legacy?.perIpPerDay ?? 500,
        },
      ]
    ),
    ...resolveBucket<LegacySigninRateLimits>('signin', config.signin, (legacy) => [
      {
        bucket: 'signin',
        type: 'ip',
        window: time.minutes(15),
        limit: legacy?.perIp15Minutes ?? 50,
      },
      {
        bucket: 'signin',
        type: 'ip',
        window: time.days(1),
        limit: legacy?.perIpPerDay ?? 500,
      },
    ]),
    ...resolveBucket<LegacyVerificationRateLimits>(
      'verification',
      config.verification,
      (legacy) => [
        {
          bucket: 'verification',
          type: 'user',
          window: time.seconds(60),
          limit: legacy?.perUserPerMinute ?? 1,
        },
        {
          bucket: 'verification',
          type: 'user',
          window: time.days(1),
          limit: legacy?.perUserPerDay ?? 10,
        },
      ]
    ),
    ...resolveBucket<LegacyPasswordResetRateLimits>(
      'passwordReset',
      config.passwordReset,
      (legacy) => [
        {
          bucket: 'passwordReset',
          type: 'ip',
          window: time.minutes(15),
          limit: legacy?.perIp15Minutes ?? 10,
        },
        {
          bucket: 'passwordReset',
          type: 'ip',
          window: time.days(1),
          limit: legacy?.perIpPerDay ?? 100,
        },
        {
          bucket: 'passwordReset',
          type: 'email',
          window: time.hours(1),
          limit: legacy?.perEmailPerHour ?? 5,
        },
        {
          bucket: 'passwordReset',
          type: 'email',
          window: time.days(1),
          limit: legacy?.perEmailPerDay ?? 10,
        },
      ]
    ),
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
  rateLimits: buildAuthRateLimits(),
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
