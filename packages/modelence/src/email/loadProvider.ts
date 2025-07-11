import { EmailProvider, EmailProviderName } from './types';

export async function loadProvider(name: EmailProviderName): Promise<EmailProvider> {
  try {
    switch (name) {
      case 'resend': {
        try {
          const { ResendProvider } = await import('./providers/ResendProvider');
          return new ResendProvider();
        } catch (err) {
          throw new Error(
            `Resend provider not found. Please install it:\n\n  npm install resend`
          );
        }
      }

      case 'ses': {
        try {
          const { AmazonSesProvider } = await import('./providers/AmazonSesProvider');
          return new AmazonSesProvider();
        } catch (err) {
          throw new Error(
            `SES provider not found. Please install it:\n\n  npm install @aws-sdk/client-ses`
          );
        }
      }

      case 'smtp': {
        try {
          const { SMTPProvider } = await import('./providers/SMTPProvider');
          return new SMTPProvider();
        } catch (err) {
          throw new Error(
            `SMTP provider not found. Please install Nodemailer:\n\n  npm install nodemailer`
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to load email provider: ${err.message}`);
    }
  }
  throw new Error(`Unsupported email provider: "${name}"`);
}
