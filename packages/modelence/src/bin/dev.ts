import { getServerPath, loadEnv } from './config';
import { execSync } from 'child_process';
import path from 'path';
import { readAppSpecFile, type AppSpec } from './appSpec';
import { runDevCommand } from './devScript';
import { loadLocalEnv, type ProcessEnv } from './localEnv';

export interface DevOptions {
  takeover?: boolean;
}

/*
  `modelence dev [args...]`, keyed on modelence.config.json like `modelence
  deploy`. Having one makes a modern app: its dev command runs with the
  connected environment's variables, the same for every app, Modelence
  framework or not. Without one it is a legacy Modelence framework app, which
  keeps starting the framework dev server.
*/
export async function dev(options: DevOptions, args: string[], cwd: string = process.cwd()) {
  let spec: AppSpec | null;
  try {
    spec = await readAppSpecFile(cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (spec) {
    // A framework app's server reads it from the environment.
    await runDevCommand(spec, args, cwd, options.takeover ? { MODELENCE_TAKEOVER: '1' } : {});
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
