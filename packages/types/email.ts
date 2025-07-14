import { ReactNode } from 'react';

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  react?: ReactNode;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
} & ({ html: string } | { text: string } | { react: React.ReactNode });

export interface EmailProvider {
  sendEmail(data: EmailPayload): Promise<void>;
}
