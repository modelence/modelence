import { getStudioUrl } from './config';

export async function authenticateCli() {
  // TODO: check if a token already exists in .modelence/auth.json

  const response = await fetch(getStudioUrl('/api/cli/auth'), {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create CLI authentication code');
  }

  const { code, verificationUrl } = await response.json();

  console.log(`Please visit ${verificationUrl} to authenticate`);
  console.log(`Code: ${code}`);

  // TODO: Implement authentication
  return { token: '1234567890' };
}
