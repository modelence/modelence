import { getServerPath } from './config';
import { execSync } from 'child_process';
import path from 'path';
import type { ProcessEnv } from './localEnv';

export function dev(options: { takeover?: boolean } = {}, env: ProcessEnv = process.env) {
  console.log('Starting Modelence dev server...');

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  execSync(`"${tsxPath}" watch --ignore "vite.config.ts.timestamp-*" "${serverPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...env,
      NODE_ENV: 'development',
      ...(options.takeover ? { MODELENCE_TAKEOVER: '1' } : {}),
    },
  });
}
