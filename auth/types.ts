import { Document, ObjectId } from 'mongodb';

export type User = Document;

export type Session = {
  authToken: string;
  expiresAt: Date;
  userId: ObjectId | null;
};
