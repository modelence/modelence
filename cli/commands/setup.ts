#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';
import fetch from 'node-fetch';

const MODELENCE_ENV_FILE = '.modelence.env';

interface SetupResponse {
  deploymentId: string;
  serviceEndpoint: string;
  serviceToken: string;
  containerId: string;
}

async function fetchServiceConfig(setupToken: string, endpoint: string): Promise<SetupResponse> {
  const response = await fetch(`https://${endpoint}/api/setup`, {
    method: 'POST',
    headers: {
      'X-Modelence-Setup-Token': setupToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Setup failed: ${response.statusText}`);
  }

  return response.json();
}

async function confirmOverwrite(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`Warning: ${MODELENCE_ENV_FILE} already exists. Do you want to overwrite it? (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export const setupCommand = new Command('setup')
  .description('Setup Modelence environment variables')
  .requiredOption('-t, --token <token>', 'Modelence setup token')
  .option('-e, --endpoint <endpoint>', 'Modelence endpoint', 'cloud.modelence.com')
  .action(async (options) => {
    try {
      const envPath = path.join(process.cwd(), MODELENCE_ENV_FILE);
      let existingEnv = {};

      try {
        // Check if .modelence.env exists
        const envContent = await fs.readFile(envPath, 'utf8');
        existingEnv = dotenv.parse(envContent);

        // Ask for confirmation before overwriting
        const shouldContinue = await confirmOverwrite();
        if (!shouldContinue) {
          console.log('Setup canceled');
          process.exit(0);
        }
      } catch (error) {
        // File doesn't exist, we'll create it
      }

      // Fetch service configuration using setup token
      console.log('Fetching service configuration...');
      const config = await fetchServiceConfig(options.token, options.endpoint);

      // Update environment variables
      const newEnv = {
        ...existingEnv,
        MODELENCE_CRON_INSTANCE: 1,
        MODELENCE_TELEMETRY_ENABLED: '',
        MODELENCE_DEPLOYMENT_ID: config.deploymentId,
        MODELENCE_SERVICE_ENDPOINT: config.serviceEndpoint,
        MODELENCE_SERVICE_TOKEN: config.serviceToken,
        MODELENCE_CONTAINER_ID: config.containerId,
      };

      // Convert to .env format
      const envContent = Object.entries(newEnv)
        .map(([key, value]) => `${key}="${value}"`)
        .join('\n');

      // Write the file
      await fs.writeFile(envPath, envContent.trim() + '\n');
      console.log(`Successfully configured ${MODELENCE_ENV_FILE} file`);

    } catch (error: unknown) {
      console.error(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }); 