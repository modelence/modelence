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
