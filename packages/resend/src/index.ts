import { Resend } from 'resend';
import { type ReactNode } from 'react';

import { type EmailProvider } from '@modelence/types';
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
  react?: ReactNode;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
} & ({ html: string } | { text: string } | { react: React.ReactNode });

let resendClient: Resend | null = null;

function initializeResendClient() {
  if (resendClient) {
    return resendClient;
  }
  const apiKey = String(getConfig('_system.email.resend.apiKey'));
  if (!apiKey) {
    throw new Error('Resend API key is not configured. Please set MODELENCE_EMAIL_RESEND_API_KEY to your environment variables or configure it from cloud.modelence.com');
  }
  resendClient = new Resend(apiKey);

  return resendClient;
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
  }: EmailPayload
) {
  const client = initializeResendClient();

  try {
    await client.emails.send({
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
      attachments: attachments?.map(attachment => ({
        name: attachment.filename,
        content: attachment.content,
        type: attachment.contentType,
      })),
    });
  } catch (error) {
    throw new Error(`Failed to send email using Resend: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default {
  sendEmail,
} as EmailProvider;
