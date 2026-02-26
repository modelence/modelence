import { AuthErrorProps, AuthSuccessProps, User } from '@/auth/types';
import { UpdateProfileProps, SignupProps } from '@/methods/types';

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

  // Custom handle generator.
  // If provided, this overrides the default handle generation logic.
  generateHandle?: (props: GenerateHandleProps) => Promise<string> | string;

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
