import { Document, ObjectId } from 'mongodb';

export type User = Document;

export type UserInfo = {
  id: string;
  handle: string;
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
