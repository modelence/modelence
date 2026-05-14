import { AuthErrorProps, AuthSuccessProps, OAuthErrorInfo, User } from '@/auth/types';
import { UpdateProfileProps, SignupProps } from '@/methods/types';
import type { RateLimitType } from '@/rate-limit/types';

/**
 * A single rate-limit rule for an authentication bucket. The `bucket` is
 * implied by which auth action you're configuring (e.g. `signup`), so callers
 * only specify the actor type, window size, and limit.
 *
 * @example
 * ```typescript
 * import { time } from 'modelence/server';
 *
 * const rule: AuthRateLimitOverride = {
 *   type: 'ip',
 *   window: time.minutes(15),
 *   limit: 10,
 * };
 * ```
 */
export type AuthRateLimitOverride = {
  /** Identifier type of the actor this rule applies to. */
  type: RateLimitType;
  /** Time window size in milliseconds. Use `time.minutes(15)` etc. */
  window: number;
  /** Maximum allowed hits within the window. */
  limit: number;
};

/** @internal Remove in 1.0.0 — superseded by `AuthRateLimitOverride[]`. */
export type LegacySignupRateLimits = {
  perIp15Minutes?: number;
  perIpPerDay?: number;
};

/** @internal Remove in 1.0.0 — superseded by `AuthRateLimitOverride[]`. */
export type LegacySignupAttemptRateLimits = {
  perIp15Minutes?: number;
  perIpPerDay?: number;
};

/** @internal Remove in 1.0.0 — superseded by `AuthRateLimitOverride[]`. */
export type LegacySigninRateLimits = {
  perIp15Minutes?: number;
  perIpPerDay?: number;
};

/** @internal Remove in 1.0.0 — superseded by `AuthRateLimitOverride[]`. */
export type LegacyVerificationRateLimits = {
  perUserPerMinute?: number;
  perUserPerDay?: number;
};

/** @internal Remove in 1.0.0 — superseded by `AuthRateLimitOverride[]`. */
export type LegacyPasswordResetRateLimits = {
  perIp15Minutes?: number;
  perIpPerDay?: number;
  perEmailPerHour?: number;
  perEmailPerDay?: number;
};

/**
 * Per-action rate limit overrides for authentication endpoints.
 *
 * Each bucket accepts an array of rules that are merged into the built-in
 * defaults by `(type, window)` tuple:
 *   - A rule whose `(type, window)` matches a default replaces that default's
 *     `limit`.
 *   - A rule whose `(type, window)` does not match any default is added as
 *     an extra rule for the bucket.
 *   - Defaults whose `(type, window)` is not overridden are kept.
 *
 * This means you can tighten a single window without accidentally dropping
 * the other built-in protections for that bucket.
 *
 * @example Tighten the 15-minute signup cap; per-day default is preserved.
 * ```typescript
 * import { startApp, time } from 'modelence/server';
 *
 * startApp({
 *   auth: {
 *     rateLimits: {
 *       signup: [
 *         { type: 'ip', window: time.minutes(15), limit: 5 },
 *       ],
 *     },
 *   },
 * });
 * ```
 *
 * @example Add an extra window alongside the defaults.
 * ```typescript
 * startApp({
 *   auth: {
 *     rateLimits: {
 *       signup: [
 *         { type: 'ip', window: time.minutes(1), limit: 2 },
 *       ],
 *     },
 *   },
 * });
 * ```
 */
export type AuthRateLimitsConfig = {
  /** Per-IP limits for the signup endpoint (successful signups only). */
  signup?: AuthRateLimitOverride[];
  /** Per-IP limits for signup attempts (checked before duplicate detection). */
  signupAttempt?: AuthRateLimitOverride[];
  /** Per-IP limits for login attempts. */
  signin?: AuthRateLimitOverride[];
  /** Per-user limits for email verification requests. */
  verification?: AuthRateLimitOverride[];
  /** Rate limits for password reset requests. */
  passwordReset?: AuthRateLimitOverride[];
};

/**
 * @internal Internal shape used by `buildAuthRateLimits` to accept both the
 * public array form and the deprecated legacy object form for back-compat.
 * Not part of the public API surface.
 *
 * Remove the legacy union arms in 1.0.0 — collapse this back to
 * `AuthRateLimitsConfig` once the object shape is gone.
 */
export type InternalAuthRateLimitsConfig = {
  signup?: AuthRateLimitOverride[] | LegacySignupRateLimits;
  signupAttempt?: AuthRateLimitOverride[] | LegacySignupAttemptRateLimits;
  signin?: AuthRateLimitOverride[] | LegacySigninRateLimits;
  verification?: AuthRateLimitOverride[] | LegacyVerificationRateLimits;
  passwordReset?: AuthRateLimitOverride[] | LegacyPasswordResetRateLimits;
};

type GenerateHandleProps = {
  email: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Callback options for authentication operations
 */
export type AuthOption = {
  /** Callback executed when authentication succeeds */
  onSuccess?: (user: User) => void;
  /** Callback executed when authentication fails */
  onError?: (error: Error) => void;
};

/**
 * Authentication configuration for the application
 *
 * @example
 * ```typescript
 * import { startApp } from 'modelence/server';
 *
 * startApp({
 *   auth: {
 *     validateSignup: ({ email, firstName, lastName, password, handle, avatarUrl }) => {
 *       // Validating the signup data
 *       if (!email || !password) {
 *         throw new Error('Email and password are required');
 *       }
 *     },
 *     onAfterLogin: ({ user }) => {
 *       console.log('User logged in:', user.name);
 *       // Redirect to dashboard
 *     },
 *     onLoginError: ({ error }) => {
 *       console.error('Login failed:', error.message);
 *       // Show error toast
 *     },
 *     onAfterSignup: ({ user }) => {
 *       console.log('User signed up:', user.email);
 *       // Send welcome email
 *     },
 *     onSignupError: ({ error }) => {
 *       console.error('Signup failed:', error.message);
 *     },
 *     generateHandle: ({ email }) => {
 *       console.log('Generating handle for:', email);
 *       // Generate handle
 *       return 'user123';
 *     },
 *   }
 * });
 * ```
 */
export type AuthConfig = {
  // Optional pre-signup validation hook.
  validateSignup?: (props: SignupProps) => void | Promise<void>;
  validateProfileUpdate?: (props: UpdateProfileProps) => void | Promise<void>;

  // After Authentication callbacks
  onAfterLogin?: (props: AuthSuccessProps) => void;
  onLoginError?: (props: AuthErrorProps) => void;
  onAfterSignup?: (props: AuthSuccessProps) => void;
  onSignupError?: (props: AuthErrorProps) => void;
  onAfterEmailVerification?: (props: AuthSuccessProps) => void;
  onEmailVerificationError?: (props: AuthErrorProps) => void;
  // OAuth account linking callbacks
  onAfterOAuthLink?: (props: AuthSuccessProps) => void;
  onOAuthLinkError?: (props: AuthErrorProps) => void;
  // Custom handle generator.
  // If provided, this overrides the default handle generation logic.
  generateHandle?: (props: GenerateHandleProps) => Promise<string> | string;

  /** deprecated: use onAfterLogin and onLoginError */
  login?: AuthOption;
  /** deprecated: user onAfterSignup and onSignupError */
  signup?: AuthOption;

  /**
   * Controls how OAuth providers handle existing accounts with matching email.
   * - 'manual' (default): Returns an error when an OAuth login matches an existing email.
   * - 'auto': Automatically links the OAuth provider to the existing account
   *   if the provider email is verified.
   */
  oauthAccountLinking?: 'auto' | 'manual';
  errorComponent?: (props: OAuthErrorInfo) => string | null | undefined;
  /**
   * Overrides the built-in rate limits for authentication endpoints. Each rule
   * you provide is merged into the defaults by `(bucket, type, window)`:
   * matching tuples replace the default `limit`, new tuples are added, and
   * unspecified defaults are preserved. See {@link AuthRateLimitsConfig} for
   * full semantics and examples.
   */
  rateLimits?: AuthRateLimitsConfig;
};

let authConfig: AuthConfig = Object.freeze({});

export function setAuthConfig(newAuthConfig: AuthConfig) {
  authConfig = Object.freeze(Object.assign({}, authConfig, newAuthConfig));
}

export function getAuthConfig() {
  return authConfig;
}
