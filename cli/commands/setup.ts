import * as fs from 'fs/promises';
import * as path from 'path';

export async function setupCommand(args: string[]) {
  const tokenIndex = args.indexOf('--token');
  if (tokenIndex === -1 || !args[tokenIndex + 1]) {
    console.error('Error: --token parameter is required');
    process.exit(1);
  }

  const token = args[tokenIndex + 1];
  await updateEnvFile(token);
}

async function updateEnvFile(token: string) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch (error) {
      // If file doesn't exist, start with empty content
      envContent = '';
    }

    // Check if MODELENCE_SERVICE_TOKEN already exists
    if (envContent.includes('MODELENCE_SERVICE_TOKEN=')) {
      envContent = envContent.replace(
        /MODELENCE_SERVICE_TOKEN=["']?[^"'\n]*["']?/,
        `MODELENCE_SERVICE_TOKEN="${token}"`
      );
    } else {
      envContent += `${envContent ? '\n' : ''}MODELENCE_SERVICE_TOKEN="${token}"`;
    }

    await fs.writeFile(envPath, envContent.trim() + '\n');
    console.log('Successfully updated MODELENCE_SERVICE_TOKEN in .env file');
  } catch (error) {
    console.error('Failed to update .env file:', error);
    throw error;
  }
} 