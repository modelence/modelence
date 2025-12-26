import { getServerPath } from './config';
import { execSync } from 'child_process';

export function start() {
  console.log('Starting Modelence production server...');

  const serverPath = getServerPath();

  execSync(`node "${serverPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
}
