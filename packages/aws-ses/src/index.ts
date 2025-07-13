import { 
  SESClient,
  SendEmailCommand,
 } from '@aws-sdk/client-ses';

import { EmailPayload, EmailProvider } from '@modelence/types';
import { getConfig } from 'modelence/server';

let resendClient: SESClient | null = null;

function initializeAmazonSESClient() {
  if (resendClient) {
    return resendClient;
  }
  const region = String(getConfig('_system.email.ses.region'));
  const accessKeyId = String(getConfig('_system.email.ses.accessKeyId'));
  const secretAccessKey = String(getConfig('_system.email.ses.secretAccessKey'));
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Amazon SES credentials are not configured. Please set MODELENCE_EMAIL_SES_REGION, MODELENCE_EMAIL_SES_ACCESS_KEY_ID and MODELENCE_EMAIL_SES_SECRET_ACCESS_KEY in your environment variables or configure them from cloud.modelence.com');
  }
  resendClient = new SESClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

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
  }: EmailPayload,
) {
  const client = initializeAmazonSESClient();

  const command = new SendEmailCommand({
    Source: from,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: html,
          Charset: 'UTF-8',
        },
      },
    },
  });

  await client.send(command);
}

export default {
  sendEmail,
} as EmailProvider;
