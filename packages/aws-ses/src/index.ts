import { 
  SendRawEmailCommand,
  SESClient,
 } from '@aws-sdk/client-ses';
import nodemailer, { createTransport } from "nodemailer";
import { type ReactNode } from 'react';

import { type EmailProvider } from '@modelence/types';
import { getConfig } from 'modelence/server';
import { renderToStaticMarkup } from 'react-dom/server';

// types are duplicated for typedoc
export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
};

export type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  react?: ReactNode;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
} & ({
  html: string;
} | {
  text: string;
} | {
  react: ReactNode;
});

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
