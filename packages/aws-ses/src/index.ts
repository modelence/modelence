import { 
  SendRawEmailCommand,
  SESClient,
 } from '@aws-sdk/client-ses';
import nodemailer, { createTransport } from "nodemailer";

import { EmailPayload, EmailProvider } from '@modelence/types';
import { getConfig } from 'modelence/server';
import { renderToStaticMarkup } from 'react-dom/server';

let sesClient: SESClient | null = null;
let nodemailerTransporter: nodemailer.Transporter | null = null;

function initializeSESClient() {
  if (sesClient) {
    return sesClient;
  }
  const region = String(getConfig('_system.email.ses.region'));
  const accessKeyId = String(getConfig('_system.email.ses.accessKeyId'));
  const secretAccessKey = String(getConfig('_system.email.ses.secretAccessKey'));
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Amazon SES credentials are not configured. Please set MODELENCE_EMAIL_SES_REGION, MODELENCE_EMAIL_SES_ACCESS_KEY_ID and MODELENCE_EMAIL_SES_SECRET_ACCESS_KEY in your environment variables or configure them from cloud.modelence.com');
  }
  sesClient = new SESClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return sesClient;
}

function initializeTransporter() {
  if (nodemailerTransporter) {
    return nodemailerTransporter;
  }
  nodemailerTransporter = createTransport({
    streamTransport: true,
    newline: "unix",
    buffer: true,
  });

  return nodemailerTransporter;
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
  const client = initializeSESClient();
  const transporter = initializeTransporter();
  const { message } = await transporter.sendMail({
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

  await client.send(new SendRawEmailCommand({
    RawMessage: {
      Data: message,
    },
  }));
}

export default {
  sendEmail,
} as EmailProvider;
