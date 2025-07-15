import type { ReactNode } from 'react';

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export type EmailPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: ReactNode;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
} & ({ html: string } | { text: string } | { react: ReactNode });

export interface EmailProvider {
  sendEmail(data: EmailPayload): Promise<void>;
}
