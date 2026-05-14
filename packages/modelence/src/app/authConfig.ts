import { AuthErrorProps, AuthSuccessProps, OAuthErrorInfo, User } from '@/auth/types';
import { UpdateProfileProps, SignupProps } from '@/methods/types';

/**
 * Per-action rate limit overrides for authentication endpoints.
 * Every field is optional — omitting it keeps the built-in default.
 *
 * @example
 * ```typescript
 * startApp({
 *   auth: {
 *     rateLimits: {
 *       signup: { perIp15Minutes: 5, perIpPerDay: 50 },
 *     },
 *   },
 * });
 * ```
 */
export type AuthRateLimitsConfig = {
  /** Per-IP limits for the signup endpoint (successful signups only). */
  signup?: {
    /** Max signups per IP in a 15-minute window. @default 20 */
    perIp15Minutes?: number;
    /** Max signups per IP per day. @default 200 */
    perIpPerDay?: number;
  };
  /** Per-IP limits for signup attempts (checked before duplicate detection). */
  signupAttempt?: {
    /** Max signup attempts per IP in a 15-minute window. @default 50 */
    perIp15Minutes?: number;
    /** Max signup attempts per IP per day. @default 500 */
    perIpPerDay?: number;
  };
  /** Per-IP limits for login attempts. */
  signin?: {
    /** Max login attempts per IP in a 15-minute window. @default 50 */
    perIp15Minutes?: number;
    /** Max login attempts per IP per day. @default 500 */
    perIpPerDay?: number;
  };
  /** Per-user limits for email verification requests. */
  verification?: {
    /** Max verification emails per user per minute. @default 1 */
    perUserPerMinute?: number;
    /** Max verification emails per user per day. @default 10 */
    perUserPerDay?: number;
  };
  /** Rate limits for password reset requests. */
  passwordReset?: {
    /** Max password reset requests per IP in a 15-minute window. @default 10 */
    perIp15Minutes?: number;
    /** Max password reset requests per IP per day. @default 100 */
    perIpPerDay?: number;
    /** Max password reset requests per email address per hour. @default 5 */
    perEmailPerHour?: number;
    /** Max password reset requests per email address per day. @default 10 */
    perEmailPerDay?: number;
  };
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
   * Overrides the built-in rate limits for authentication endpoints.
   * Only the fields you specify are overridden; all others keep their defaults.
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
