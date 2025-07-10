export interface EmailData {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface EmailProvider {
  sendEmail(data: EmailData): Promise<void>;
}
