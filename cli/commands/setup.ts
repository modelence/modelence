import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

const MODELENCE_ENV_FILE = '.modelence.env';

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
  .requiredOption('-t, --token <token>', 'Modelence service token')
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
          console.log('Setup cancelled');
          process.exit(0);
        }
      } catch (error) {
        // File doesn't exist, we'll create it
      }

      // Update or add the variables
      const newEnv = {
        ...existingEnv,
        MODELENCE_CRON_INSTANCE: 1,
        MODELENCE_SERVICE_TOKEN: options.token
      };

      // Convert to .env format
      const envContent = Object.entries(newEnv)
        .map(([key, value]) => `${key}="${value}"`)
        .join('\n');

      // Write the file
      await fs.writeFile(envPath, envContent.trim() + '\n');
      console.log(`Successfully updated ${MODELENCE_ENV_FILE} file`);

    } catch (error) {
      console.error(`Failed to update ${MODELENCE_ENV_FILE} file:`, error);
      process.exit(1);
    }
  }); 