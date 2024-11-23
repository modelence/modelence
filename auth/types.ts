import { Document } from 'mongodb';

export type User = Document;

export type Session = {
  authToken: string;
  expiresAt: Date;
  userId: string | null;
};
