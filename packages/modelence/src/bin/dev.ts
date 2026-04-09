import { getConfig } from './config';
import { execSync } from 'child_process';
import path from 'path';
import { generateAutoLoadFiles } from './scan';

export async function dev() {
  console.log('Starting Modelence dev server...');

  const { serverDir, serverEntry } = getConfig();
  await generateAutoLoadFiles(serverDir, serverEntry);

  const entryPath = path.resolve('.modelence/generated/entry.ts');
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  execSync(
    `"${tsxPath}" watch --ignore "vite.config.ts.timestamp-*" --ignore ".modelence/**" "${entryPath}"`,
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'development' },
    }
  );
}
