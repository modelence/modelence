import { getConfig } from '@/server';
import { loadProvider } from './loadProvider';
import { EmailData } from './types';

export async function sendEmail(data: EmailData) {
  const emailProviderName = String(getConfig('_system.email.provider')) || 'resend';
  const emailProvider = await loadProvider(emailProviderName);

  await emailProvider.sendEmail(data);
}
