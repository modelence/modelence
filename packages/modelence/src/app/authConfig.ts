import { AuthErrorProps, AuthSuccessProps, User } from '@/auth/types';
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
