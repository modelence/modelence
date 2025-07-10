import {
  SESClient,
  SendEmailCommand,
} from '@aws-sdk/client-ses';
import { EmailData, EmailProvider } from '../types';
import { getConfig } from '@/server';

export class AmazonSesProvider implements EmailProvider {
  private client: SESClient;

  constructor() {
    const region = String(getConfig('_system.email.ses.region')) || 'us-east-1';
    const accessKeyId = String(getConfig('_system.email.ses.accessKeyId'));
    const secretAccessKey = String(getConfig('_system.email.ses.secretAccessKey'));

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Amazon SES credentials are not configured. Please set accessKeyId and secretAccessKey in your environment variables or configure them from cloud.modelence.com');
    }

    this.client = new SESClient({
      region: region,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });
  }

  async sendEmail({ from, to, subject, html }: EmailData) {
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

    await this.client.send(command);
  }
}
