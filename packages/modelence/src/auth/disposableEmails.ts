import { time } from '../time';
import { dbDisposableEmailDomains } from './db';

export async function isDisposableEmail(email: string): Promise<boolean> {
  const emailParts = email.toLowerCase().trim().split('@');
  if (emailParts.length !== 2) {
    return false;
  }

  const domain = emailParts[1];
  const result = await dbDisposableEmailDomains.findOne({ domain });
  return Boolean(result);
}

export const updateDisposableEmailListCron = {
  interval: time.days(1),
  async handler() {
    const response = await fetch(
      'https://disposable.github.io/disposable-email-domains/domains.txt'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const domainsText = await response.text();

    const domains = domainsText
      .split('\n')
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0);

    const now = new Date();

    // Insert domains in batches to avoid overwhelming the database
    const batchSize = 500;
    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize);

      try {
        await dbDisposableEmailDomains.insertMany(
          batch.map((domain) => ({
            domain,
            addedAt: now,
          }))
        );
      } catch (error: any) {
        // MongoDB throws BulkWriteError when some documents are duplicates
        if (error.name === 'MongoBulkWriteError' && error.result?.nInserted) {
          // console.warn(`Error inserting batch starting at index ${i}:`, error.message);
        }
      }
    }
  },
};
