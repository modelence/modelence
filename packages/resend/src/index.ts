import { Resend } from 'resend';

import { EmailPayload, EmailProvider } from '@modelence/types';
import { getConfig } from 'modelence/server';

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
 * import { sendEmail } from '@modelence/resend';
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
 * @returns Query options object for TanStack Query's useQuery
 * 
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
    });
  } catch (error) {
    throw new Error(`Failed to send email using Resend: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default {
  sendEmail,
} as EmailProvider;
