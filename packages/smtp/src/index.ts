import nodemailer from 'nodemailer';
import { renderToStaticMarkup } from 'react-dom/server';

import { EmailPayload, EmailProvider } from '@modelence/types';
import { getConfig } from 'modelence/server';

let smtpClient: nodemailer.Transporter | null = null;

function initializeAmazonSESClient() {
  if (smtpClient) {
    return smtpClient;
  }
  const host = String(getConfig('_system.email.smtp.host'));
  const port = Number(getConfig('_system.email.smtp.port'));
  const user = String(getConfig('_system.email.smtp.user'));
  const pass = String(getConfig('_system.email.smtp.pass'));

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
 * Sends an email via SMTP.
 * 
 * @example
 * ```ts
 * import { sendEmail } from '@modelence/smtp';
 * 
 * sendEmail({
 *  from: 'test@example.com',
 *  to: 'test@example.com',
 *  subject: 'Test Email',
 *  html: '<h1>Hello World</h1>'
 * })
 * ```
 * 
 * @param data - The email payload containing sender, recipient, subject, and HTML content.
 * 
 */
export async function sendEmail(
  {
    from,
    to,
    subject,
    html,
    react,
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
    html: html || react ? renderToStaticMarkup(react) : undefined,
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
