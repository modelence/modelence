import { loadProvider } from './loadProvider';
import { EmailData, EmailProviderName } from './types';

export async function sendEmail(providerName: EmailProviderName, data: EmailData) {
  const emailProvider = await loadProvider(providerName);

  await emailProvider.sendEmail(data);
}
