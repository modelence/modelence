import { getBuildPath, getServerPath } from './config';
import { execSync } from 'child_process';
import path from 'path';

export function start() {
  console.log('Starting Modelence production server...');

  const serverPath = getServerPath();
  const serverFilename = path.basename(serverPath, path.extname(serverPath));
  const builtServerPath = getBuildPath(`${serverFilename}.mjs`);

  execSync(`node "${builtServerPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production' },
  });
}
