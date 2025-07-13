export type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface EmailProvider {
  sendEmail(data: EmailPayload): Promise<void>;
}
