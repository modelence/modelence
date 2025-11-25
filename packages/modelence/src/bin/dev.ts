import { getServerPath } from './config';
import { execSync } from 'child_process';
import path from 'path';
import { generateStores } from '../codegen';

export async function dev() {
  console.log('Starting Modelence dev server...');

  // Generate zustand stores before starting dev server
  try {
    await generateStores();
  } catch (error) {
    console.warn('⚠️  Store generation failed, continuing anyway...');
    console.warn(error);
  }

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  execSync(`"${tsxPath}" watch "${serverPath}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
  });
}
