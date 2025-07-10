import resend from 'resend';
import { EmailData } from '../types';
import { getConfig } from '@/server';

export class ResendProvider {
  private client: resend.Resend;

  constructor() {
    const apiKey = String(getConfig('_system.email.resend.apiKey'));
    if (!apiKey) {
      throw new Error('Resend API key is not configured. Please set it from add RESEND_API_KEY to your environment variables or configure it from cloud.modelence.com');
    }
    this.client = new resend.Resend(apiKey);
  }

  async sendEmail(data: EmailData) {
    try {
      await this.client.emails.send({
        from: data.from,
        to: data.to,
        subject: data.subject,
        html: data.html,
      });
    } catch (error) {
      throw new Error(`Failed to send email using Resend: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
