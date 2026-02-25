import { Document, ObjectId } from 'mongodb';
import { ConnectionInfo } from '@/methods/types';

export type User = Document;

export type UserInfo = {
  /** The user's unique identifier. */
  id: string;
  /** The user's display handle. */
  handle: string;
  /** The role strings assigned to this user in the database. */
  roles: string[];
  /** Returns `true` if the user has the given role. */
  hasRole: (role: string) => boolean;
  /** Throws an error if the user does not have the given role. */
  requireRole: (role: string) => void;
};

export type Role = string;

export type DefaultRoles = Record<'authenticated' | 'unauthenticated', Role | null>;

export type Session = {
  authToken: string;
  expiresAt: Date;
  userId: ObjectId | null;
};

export type Permission = string;

/**
 * Defines a role that can be assigned to users.
 *
 * Roles are registered via the `roles` option in {@link AppOptions} and
 * are synced to the Modelence Cloud dashboard for user management.
 *
 * @example
 * ```typescript
 * import { startApp } from 'modelence/server';
 *
 * startApp({
 *   roles: {
 *     admin: { description: 'Full access to all features' },
 *     editor: { description: 'Can edit content' },
 *     viewer: {},
 *   },
 * });
 * ```
 */
export type RoleDefinition = {
  /** Human-readable description of the role, shown in the Modelence Cloud dashboard. */
  description?: string;
  /** @internal */
  permissions?: Permission[];
};

export type AuthProvider = 'google' | 'github' | 'email';

export type AuthSuccessProps = {
  provider: AuthProvider;
  user: User;
  session: Session | null;
  connectionInfo: ConnectionInfo;
};

export type AuthErrorProps = {
  provider: AuthProvider;
  error: Error;
  session: Session | null;
  connectionInfo: ConnectionInfo;
};
