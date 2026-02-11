import { Document, ObjectId } from 'mongodb';
import { ConnectionInfo } from '@/methods/types';

export type User = Document;

export type UserInfo = {
  id: string;
  handle: string;
  roles: string[];
  hasRole: (role: string) => boolean;
  requireRole: (role: string) => void;
  name?: string;
  picture?: string;
};

export type Role = string;

export type DefaultRoles = Record<'authenticated' | 'unauthenticated', Role | null>;

export type Session = {
  authToken: string;
  expiresAt: Date;
  userId: ObjectId | null;
};

export type Permission = string;

export type RoleDefinition = {
  description?: string;
  permissions: Permission[];
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
