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
 * @typedef {Object} EmailAttachment
 * @property {string} filename - The name of the file.
 * @property {Buffer|string} content - The file content as a Buffer or string.
 * @property {string} contentType - The MIME type of the attachment.
 */

/**
 * @typedef {Object} EmailPayload
 * @property {string} from - Sender email address.
 * @property {string} to - Recipient email address.
 * @property {string} subject - Email subject.
 * @property {string} [html] - HTML body content (required if `text` and `react` are not provided).
 * @property {string} [text] - Plain text body content (required if `html` and `react` are not provided).
 * @property {React.ReactNode} [react] - React component to render email (required if `html` and `text` are not provided).
 * @property {string} [cc] - CC email address.
 * @property {string} [bcc] - BCC email address.
 * @property {string} [replyTo] - Reply-To address.
 * @property {Object.<string, string>} [headers] - Custom email headers.
 * @property {EmailAttachment[]} [attachments] - List of attachments.
 *
 * @note Exactly one of `html`, `text`, or `react` must be provided.
 */

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
 * @param {EmailPayload} payload - The email payload object.
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
