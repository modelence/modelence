import { getServerPath } from './config';
import { execSync } from 'child_process';
import path from 'path';

export function dev() {
  console.log('Starting Modelence dev server...');

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  execSync(`"${tsxPath}" watch --ignore "vite.config.ts.timestamp-*" "${serverPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
  });
}
