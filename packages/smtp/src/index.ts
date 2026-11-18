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

// 465 is the standard implicit-TLS port; 2465 is Amazon SES's alternate one.
const IMPLICIT_TLS_PORTS: ReadonlySet<number> = new Set([465, 2465]);

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
  const implicitTls = IMPLICIT_TLS_PORTS.has(port);
  smtpClient = nodemailer.createTransport({
    host,
    port,
    // Implicit TLS only on 465/2465. Other ports (587, 25, 2525) start in plaintext
    // and must upgrade with STARTTLS before credentials are sent; if the
    // server doesn't offer STARTTLS, sending fails instead of falling back.
    secure: implicitTls,
    requireTLS: !implicitTls,
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
