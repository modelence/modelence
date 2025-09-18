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
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
} & ({ html: string } | { text: string });

export interface EmailProvider {
  sendEmail(data: EmailPayload): Promise<void>;
}
