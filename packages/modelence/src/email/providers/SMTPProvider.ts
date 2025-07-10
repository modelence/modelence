import nodemailer from 'nodemailer';
import { getConfig } from '@/server';
import { EmailData, EmailProvider } from '../types';

export class SMTPProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    const host = String(getConfig('_system.email.smtp.host'));
    const port = Number(getConfig('_system.email.smtp.port'));
    const secure = getConfig('_system.email.smtp.secure') === "true" || false;
    const user = String(getConfig('_system.email.smtp.user'));
    const pass = String(getConfig('_system.email.smtp.pass'));

    if (!host || !port) {
      throw new Error('SMTP host and port must be configured. Please set them in your environment variables or configure them from cloud.modelence.com');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  async sendEmail({ from, to, subject, html }: EmailData) {
    await this.transporter.sendMail({
      from,
      to,
      subject,
      html,
    });
  }
}
