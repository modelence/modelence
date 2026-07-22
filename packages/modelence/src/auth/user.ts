import { randomBytes } from 'crypto';

import type { AuthRateLimitsConfig } from '../app/authConfig';
import { Module } from '../app/module';
import { RateLimitRule } from '../rate-limit/types';
import { time } from '../time';
import {
  dbDisposableEmailDomains,
  emailVerificationTokensCollection,
  magicLinkTokensCollection,
  resetPasswordTokensCollection,
  usersCollection,
} from './db';
import { updateDisposableEmailListCron } from './disposableEmails';
import { handleLoginWithPassword, handleLogout } from './login';
import { getOwnProfile, handleUpdateProfile } from './profile';
import { handleUnlinkOAuthProvider } from './unlinkOAuthProvider';
import { handleSignupWithPassword } from './signup';
import { handleVerifyEmail, handleResendEmailVerification } from './verification';
import {
  handleResetPassword,
  handleResetPasswordLanding,
  handleSendResetPasswordToken,
} from './resetPassword';
import {
  handleLoginWithMagicLink,
  handleLoginWithOneTimeCode,
  handleMagicLinkLanding,
  handleSendMagicLink,
} from './magicLink';

function ruleKey(rule: Pick<RateLimitRule, 'bucket' | 'type' | 'window'>): string {
  return `${rule.bucket}\n${rule.type}\n${rule.window}`;
}

function defaultAuthRateLimits(): RateLimitRule[] {
  return [
    { bucket: 'signup', type: 'ip', window: time.minutes(15), limit: 20 },
    { bucket: 'signup', type: 'ip', window: time.days(1), limit: 200 },
    { bucket: 'signupAttempt', type: 'ip', window: time.minutes(15), limit: 50 },
    { bucket: 'signupAttempt', type: 'ip', window: time.days(1), limit: 500 },
    { bucket: 'signin', type: 'ip', window: time.minutes(15), limit: 50 },
    { bucket: 'signin', type: 'ip', window: time.days(1), limit: 500 },
    { bucket: 'verification', type: 'user', window: time.seconds(60), limit: 1 },
    { bucket: 'verification', type: 'user', window: time.days(1), limit: 10 },
    { bucket: 'passwordReset', type: 'ip', window: time.minutes(15), limit: 10 },
    { bucket: 'passwordReset', type: 'ip', window: time.days(1), limit: 100 },
    { bucket: 'passwordReset', type: 'email', window: time.hours(1), limit: 5 },
    { bucket: 'passwordReset', type: 'email', window: time.days(1), limit: 10 },
    { bucket: 'magicLink', type: 'ip', window: time.minutes(15), limit: 10 },
    { bucket: 'magicLink', type: 'ip', window: time.days(1), limit: 100 },
    { bucket: 'magicLink', type: 'email', window: time.hours(1), limit: 5 },
    { bucket: 'magicLink', type: 'email', window: time.days(1), limit: 10 },
    { bucket: 'oneTimeCode', type: 'ip', window: time.minutes(15), limit: 20 },
    { bucket: 'oneTimeCode', type: 'ip', window: time.days(1), limit: 100 },
    { bucket: 'oneTimeCode', type: 'email', window: time.hours(1), limit: 10 },
    { bucket: 'oneTimeCode', type: 'email', window: time.days(1), limit: 20 },
    { bucket: 'updateProfile', type: 'user', window: time.minutes(15), limit: 30 },
    { bucket: 'updateProfile', type: 'user', window: time.days(1), limit: 200 },
  ];
}

function collectOverrides(config: AuthRateLimitsConfig): RateLimitRule[] {
  const overrides: RateLimitRule[] = [];

  const buckets: Array<keyof AuthRateLimitsConfig> = [
    'signup',
    'signupAttempt',
    'signin',
    'verification',
    'passwordReset',
    'magicLink',
    'oneTimeCode',
    'updateProfile',
  ];

  for (const bucket of buckets) {
    const rules = config[bucket];
    if (rules === undefined) continue;
    for (const rule of rules) {
      overrides.push({ bucket, ...rule });
    }
  }

  return overrides;
}

/**
 * Builds the rate limit rules for all authentication endpoints by merging
 * caller-supplied overrides into the built-in defaults.
 *
 * Merge semantics:
 *   - Each override rule replaces the default rule with the same
 *     (bucket, type, window) tuple.
 *   - Defaults whose tuple is not overridden are preserved.
 *   - Override rules with no matching default are added.
 *
 * This means `signup: [{ type: 'ip', window: time.minutes(15), limit: 10 }]`
 * tightens the 15-minute signup cap without dropping the per-day cap.
 */
export function buildAuthRateLimits(config: AuthRateLimitsConfig = {}): RateLimitRule[] {
  const defaults = defaultAuthRateLimits();
  const overrides = collectOverrides(config);

  const overrideByKey = new Map<string, RateLimitRule>();
  for (const rule of overrides) {
    overrideByKey.set(ruleKey(rule), rule);
  }

  const merged: RateLimitRule[] = [];
  const consumed = new Set<string>();
  for (const def of defaults) {
    const key = ruleKey(def);
    const override = overrideByKey.get(key);
    if (override !== undefined) {
      merged.push(override);
      consumed.add(key);
    } else {
      merged.push(def);
    }
  }
  for (const [key, rule] of overrideByKey) {
    if (!consumed.has(key)) {
      merged.push(rule);
    }
  }
  return merged;
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
    magicLinkTokensCollection,
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
    sendMagicLink: handleSendMagicLink,
    loginWithMagicLink: handleLoginWithMagicLink,
    loginWithOneTimeCode: handleLoginWithOneTimeCode,
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
      default: true,
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
    {
      // Server landing for password reset (see handleResetPasswordLanding).
      // Runs before the SPA catch-all.
      path: '/api/_internal/auth/reset-password',
      handlers: {
        get: handleResetPasswordLanding,
      },
    },
    {
      // Server landing for magic link sign-in (see handleMagicLinkLanding).
      // Runs before the SPA catch-all.
      path: '/api/_internal/auth/magic-link',
      handlers: {
        get: handleMagicLinkLanding,
      },
    },
  ],
});
