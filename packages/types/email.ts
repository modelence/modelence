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
  cc?: string;
  bcc?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  sendEmail(data: EmailPayload): Promise<void>;
}
