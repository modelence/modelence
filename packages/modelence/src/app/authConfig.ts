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
 *     login: {
 *       onSuccess: (user) => {
 *         console.log('User logged in:', user.name);
 *         // Redirect to dashboard
 *       },
 *       onError: (error) => {
 *         console.error('Login failed:', error.message);
 *         // Show error toast
 *       }
 *     },
 *     signup: {
 *       onSuccess: (user) => {
 *         console.log('User signed up:', user.email);
 *         // Send welcome email
 *       },
 *       onError: (error) => {
 *         console.error('Signup failed:', error.message);
 *       }
 *     }
 *   }
 * });
 * ```
 */
export type AuthConfig = {
  afterLogin?: (props: {
    user: User,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  loginError?: (props: {
    error: Error,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  afterSignup?: (props: {
    user: User,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;
  signupError?: (props: {
    error: Error,
    session: Session | null,
    connectionInfo: ConnectionInfo,
  }) => void;

  /** deprecated: use afterLogin and loginError */
  login?: AuthOption;
  /** deprecated: user afterSignup and signupError */
  signup?: AuthOption;
};

let authConfig: AuthConfig = Object.freeze({});

export function setAuthConfig(newAuthConfig: AuthConfig) {
  authConfig = Object.freeze(Object.assign({}, authConfig, newAuthConfig));
}

export function getAuthConfig() {
  return authConfig;
}
