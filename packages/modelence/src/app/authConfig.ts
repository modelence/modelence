import { Session, User } from "@/auth/types";
import { ConnectionInfo } from "@/methods/types";

/**
 * Callback options for authentication operations
 */
export type AuthOption = {
  /** Callback executed when authentication succeeds */
  onSuccess?: (user: User) => void;
  /** Callback executed when authentication fails */
  onError?: (error: Error) => void;
}

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
  onAfterLogin?: (props: {
    user: User,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  onLoginError?: (props: {
    error: Error,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  onAfterSignup?: (props: {
    user: User,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  onSignupError?: (props: {
    error: Error,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;

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
