import nodemailer from 'nodemailer';

import type { EmailProvider } from 'modelence/types';
import { getConfig } from 'modelence/server';

// types are duplicated for typedoc
export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
};

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

let smtpClient: nodemailer.Transporter | null = null;

function initializeAmazonSESClient() {
  if (smtpClient) {
    return smtpClient;
  }
  const host = getConfig('_system.email.smtp.host') as string | undefined;
  const port = Number(getConfig('_system.email.smtp.port'));
  const user = getConfig('_system.email.smtp.user') as string | undefined;
  const pass = getConfig('_system.email.smtp.pass') as string | undefined;

  if (!host || !port) {
    throw new Error('SMTP host and port must be configured. Please set MODELENCE_EMAIL_SMTP_HOST, MODELENCE_EMAIL_SMTP_PORT, MODELENCE_EMAIL_SMTP_USER, MODELENCE_EMAIL_SMTP_PASS in your environment variables or configure them from cloud.modelence.com');
  }
  smtpClient = nodemailer.createTransport({
    host,
    port,
    secure: true,
    auth: {
      user,
      pass,
    },
  });

  return smtpClient;
}

/**
 * Sends an email via Resend.
 * 
 * @example
 * ```ts
 * import { sendEmail } from '@modelence/aws-ses';
 * 
 * sendEmail({
 *  from: 'test@example.com',
 *  to: 'test@example.com',
 *  subject: 'Test Email',
 *  html: '<h1>Hello World</h1>'
 * })
 * ```
 * 
 * @param payload - The email payload object.
 */
export async function sendEmail(
  {
    from,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
    headers,
    attachments,
  }: EmailPayload,
) {
  const client = initializeAmazonSESClient();

  await client.sendMail({
    from,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
    headers,
    attachments,
  });
}

export default {
  sendEmail,
} as EmailProvider;
