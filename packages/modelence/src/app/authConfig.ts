import { AuthErrorProps, AuthSuccessProps, User } from '@/auth/types';

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
 *     }
 *   }
 * });
 * ```
 */
export type AuthConfig = {
  onAfterLogin?: (props: AuthSuccessProps) => void;
  onLoginError?: (props: AuthErrorProps) => void;
  onAfterSignup?: (props: AuthSuccessProps) => void;
  onSignupError?: (props: AuthErrorProps) => void;
  onAfterEmailVerification?: (props: AuthSuccessProps) => void;
  onEmailVerificationError?: (props: AuthErrorProps) => void;

  /** deprecated: use onAfterLogin and onLoginError */
  login?: AuthOption;
  /** deprecated: user onAfterSignup and onSignupError */
  signup?: AuthOption;
};

let authConfig: AuthConfig = Object.freeze({});

export function setAuthConfig(newAuthConfig: AuthConfig) {
  authConfig = Object.freeze(Object.assign({}, authConfig, newAuthConfig));
}

export function getAuthConfig() {
  return authConfig;
}
