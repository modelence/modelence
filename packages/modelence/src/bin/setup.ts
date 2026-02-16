import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseEnv } from 'dotenv';
import { createInterface } from 'readline';

const MODELENCE_ENV_FILE = '.modelence.env';

interface SetupResponse {
  environmentId: string;
  serviceEndpoint: string;
  serviceToken: string;
  containerId: string;
}

async function fetchServiceConfig(setupToken: string, host: string): Promise<SetupResponse> {
  const response = await fetch(`${host}/api/setup`, {
    method: 'GET',
    headers: {
      'X-Modelence-Setup-Token': setupToken,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function confirmOverwrite(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `Warning: ${MODELENCE_ENV_FILE} already exists. Do you want to overwrite it? (y/N) `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      }
    );
  });
}

function escapeEnvValue(value: string | number): string {
  // Convert to string and escape quotes
  return String(value).replace(/"/g, '\\"');
}

async function backupEnvFile(envPath: string): Promise<void> {
  try {
    const backupPath = envPath.replace('.env', '.backup.env');
    await fs.copyFile(envPath, backupPath);
    console.log(`Backup created at ${backupPath}`);
  } catch (error) {
    console.warn('Failed to create backup file:', error);
  }
}

export async function setup(options: { token: string; host: string }) {
  try {
    const envPath = join(process.cwd(), MODELENCE_ENV_FILE);
    let existingEnv = {};

    try {
      // Check if .modelence.env exists
      const envContent = await fs.readFile(envPath, 'utf8');
      existingEnv = parseEnv(envContent);

      // Create backup before overwriting
      await backupEnvFile(envPath);

      // Ask for confirmation before overwriting
      const shouldContinue = await confirmOverwrite();
      if (!shouldContinue) {
        console.log('Setup canceled');
        process.exit(0);
      }
    } catch {
      // File doesn't exist, we'll create it
    }

    // Fetch service configuration using setup token
    console.log('Fetching service configuration...');
    const config = await fetchServiceConfig(options.token, options.host);

    // Update environment variables
    const newEnv = {
      ...existingEnv,
      MODELENCE_TELEMETRY_ENABLED: 'false', // TODO: Remove after all usages are gone
      MODELENCE_ENVIRONMENT_ID: config.environmentId,
      MODELENCE_SERVICE_ENDPOINT: options.host, // TODO: Replace with config.serviceEndpoint in the future
      MODELENCE_SERVICE_TOKEN: config.serviceToken,
      MODELENCE_CONTAINER_ID: config.containerId,
    };

    // Convert to .env format with escaped values
    const envContent = Object.entries(newEnv)
      .map(([key, value]) => `${key}="${escapeEnvValue(value)}"`)
      .join('\n');

    // Write the file
    await fs.writeFile(envPath, envContent.trim() + '\n');
    console.log(`Successfully configured ${MODELENCE_ENV_FILE} file`);
  } catch (error: unknown) {
    console.error(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
