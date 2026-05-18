import { AuthErrorProps, AuthSuccessProps, OAuthErrorInfo, User } from '@/auth/types';
import { ConnectionInfo, UpdateProfileProps, SignupProps } from '@/methods/types';
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
 * Props passed to {@link AuthConfig.onBeforeSignup}.
 *
 * The hook fires after validation and the built-in disposable-email check,
 * but before the user document is inserted. Throwing aborts the signup —
 * the thrown error is re-thrown to the caller and `onSignupError` fires.
 */
export type BeforeSignupProps = {
  /** Lowercased, validated email address. */
  email: string;
  firstName?: string;
  lastName?: string;
  handle?: string;
  /** Provider that initiated the signup. Currently only `'email'`. */
  provider: 'email';
  connectionInfo?: ConnectionInfo;
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
  /**
   * Pre-signup validation hook. Runs before a new user is created during
   * email/password signup, after format checks but before duplicate detection.
   * Throw to reject the signup — the thrown message is surfaced to the client.
   *
   * Receives the raw signup payload (`email`, `password`, and optional
   * `firstName`, `lastName`, `avatarUrl`, `handle`). May be async.
   */
  validateSignup?: (props: SignupProps) => void | Promise<void>;

  /**
   * Pre-update validation hook. Runs before a user's profile fields
   * (`firstName`, `lastName`, `avatarUrl`, `handle`) are written.
   * Throw to reject the update — the thrown message is surfaced to the client.
   * May be async.
   */
  validateProfileUpdate?: (props: UpdateProfileProps) => void | Promise<void>;

  /**
   * Fires after a successful login (email/password or OAuth) once the session
   * has been linked to the user. Receives `{ provider, user, session, connectionInfo }`.
   * Use for analytics, audit logging, or post-login side effects.
   */
  onAfterLogin?: (props: AuthSuccessProps) => void;

  /**
   * Fires when a login attempt fails. Receives `{ provider, error, session, connectionInfo }`.
   * Use for failure analytics or alerting — does NOT change the response sent to the client.
   */
  onLoginError?: (props: AuthErrorProps) => void;

  /**
   * Hook fired after validation and the built-in disposable-email check, but
   * before the new user document is inserted. Throwing aborts the signup —
   * the thrown error is re-thrown to the caller and `onSignupError` fires.
   *
   * Use this to plug in a custom domain-policy check (e.g. a tenant-specific
   * email-domain verification service) without having to disable the built-in
   * disposable-email check.
   *
   * Currently only invoked for `'email'` provider signups. OAuth signups are
   * not gated because OAuth providers (Google, GitHub, etc.) do not issue
   * disposable accounts.
   */
  onBeforeSignup?: (props: BeforeSignupProps) => void | Promise<void>;

  /**
   * Fires after a successful signup once the user record is created and the
   * session is linked. Receives `{ provider, user, session, connectionInfo }`.
   * Common uses: send welcome email, create default workspace, track activation.
   */
  onAfterSignup?: (props: AuthSuccessProps) => void;

  /**
   * Fires when a signup attempt fails (validation, duplicate email, etc.).
   * Receives `{ provider, error, session, connectionInfo }`.
   * Use for failure analytics — does NOT change the response sent to the client.
   */
  onSignupError?: (props: AuthErrorProps) => void;

  /**
   * Fires after a user's email is successfully verified (via the verification
   * link or implicitly via password reset). Receives `{ provider, user, session, connectionInfo }`.
   */
  onAfterEmailVerification?: (props: AuthSuccessProps) => void;

  /**
   * Fires when email verification fails (invalid or expired token).
   * Receives `{ provider, error, session, connectionInfo }`.
   */
  onEmailVerificationError?: (props: AuthErrorProps) => void;

  /**
   * Fires after an OAuth provider is linked to an existing account
   * (either automatically when `oauthAccountLinking: 'auto'` or via an
   * explicit link flow). Receives `{ provider, user, session, connectionInfo }`.
   */
  onAfterOAuthLink?: (props: AuthSuccessProps) => void;

  /**
   * Fires when OAuth account linking fails. Receives
   * `{ provider, error, session, connectionInfo }`.
   */
  onOAuthLinkError?: (props: AuthErrorProps) => void;

  /**
   * Custom handle generator. If provided, overrides the default behavior
   * (which derives the handle from the email local-part). Receives
   * `{ email, firstName?, lastName? }` and returns the desired handle
   * synchronously or as a `Promise<string>`. If the returned handle collides
   * with an existing one, Modelence appends a numeric suffix automatically.
   */
  generateHandle?: (props: GenerateHandleProps) => Promise<string> | string;

  /** @deprecated Use {@link AuthConfig.onAfterLogin} and {@link AuthConfig.onLoginError} instead. */
  login?: AuthOption;
  /** @deprecated Use {@link AuthConfig.onAfterSignup} and {@link AuthConfig.onSignupError} instead. */
  signup?: AuthOption;

  /**
   * Controls how OAuth providers handle existing accounts with matching email.
   * - 'manual' (default): Returns an error when an OAuth login matches an existing email.
   * - 'auto': Automatically links the OAuth provider to the existing account
   *   if the provider email is verified.
   */
  oauthAccountLinking?: 'auto' | 'manual';

  /**
   * Customizes how OAuth authentication errors are rendered. By default,
   * OAuth errors are returned as JSON; providing this returns a custom HTML
   * response instead, which is useful when the OAuth flow runs in a browser
   * context. Receives `{ error, statusCode }` and returns an HTML string
   * (or `null`/`undefined` to fall back to the default JSON response).
   *
   * Always escape interpolated values to prevent XSS.
   */
  errorComponent?: (props: OAuthErrorInfo) => string | null | undefined;

  /**
   * Overrides the built-in rate limits for authentication endpoints. Each rule
   * you provide is merged into the defaults by `(bucket, type, window)`:
   * matching tuples replace the default `limit`, new tuples are added, and
   * unspecified defaults are preserved. See {@link AuthRateLimitsConfig} for
   * full semantics and examples.
   */
  rateLimits?: AuthRateLimitsConfig;

  /**
   * When `true`, the built-in disposable-email check is skipped during signup.
   * Defaults to `false` (built-in check enforced).
   *
   * Set this to `true` when you want to enforce your own domain-policy logic
   * via {@link onBeforeSignup} — for example, a service that classifies
   * domains as public/disposable/custom with its own data sources and cache.
   *
   * Skipping the built-in check without registering an `onBeforeSignup` hook
   * means disposable emails will be allowed to sign up.
   */
  allowDisposableEmails?: boolean;
};

let authConfig: AuthConfig = Object.freeze({});

export function setAuthConfig(newAuthConfig: AuthConfig) {
  authConfig = Object.freeze(Object.assign({}, authConfig, newAuthConfig));
}

export function getAuthConfig() {
  return authConfig;
}
