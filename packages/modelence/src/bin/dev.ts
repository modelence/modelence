import dotenv from 'dotenv';
import { getServerPath } from './config';
import { execSync } from 'child_process';
import path from 'path';

export function dev() {
  console.log('Starting Modelence dev server...');

  // Load user environment variables so they can override our defaults
  dotenv.config();
  dotenv.config({ path: '.modelence.env' });

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  execSync(`"${tsxPath}" watch "${serverPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      MODELENCE_MIGRATIONS_ENABLED: 'true',
      ...process.env,
      NODE_ENV: 'development',
    },
  });
}
