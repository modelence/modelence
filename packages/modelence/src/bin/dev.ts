import { getServerPath, loadEnv } from './config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { runDevScript } from './devScript';
import { loadLocalEnv, type ProcessEnv } from './localEnv';

export interface DevOptions {
  takeover?: boolean;
}

/*
  A Modelence framework app is one with a modelence.config.ts: that file is
  what the framework dev server starts from. Depending on the `modelence`
  package doesn't make one, since any project may install it for the CLI.
*/
export function isFrameworkApp(cwd: string): boolean {
  return existsSync(path.join(cwd, 'modelence.config.ts'));
}

/*
  `modelence dev [args...]`: starts the framework dev server in a Modelence
  framework app, and the project's package.json `dev` script in any other
  project — both with the connected environment's variables loaded.
*/
export async function dev(options: DevOptions, args: string[], cwd: string = process.cwd()) {
  if (!isFrameworkApp(cwd)) {
    if (options.takeover) {
      console.warn('--takeover only applies to Modelence framework apps; ignoring it.');
    }
    await runDevScript(args, cwd);
    return;
  }

  if (args.length > 0) {
    console.warn(`Ignoring arguments for the Modelence dev server: ${args.join(' ')}`);
  }
  await loadEnv();
  startFrameworkDevServer(options, await loadLocalEnv(cwd, process.env));
}

function startFrameworkDevServer(options: DevOptions, env: ProcessEnv) {
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
