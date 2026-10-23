import { getServerPath, loadEnv } from './config';
import path from 'path';
import { readAppSpecFile, type AppSpec } from './appSpec';
import { isInsideDevCommand, runDevCommand } from './devScript';
import { spawnProcessTree } from './processTree';

export interface DevOptions {
  takeover?: boolean;
}

/*
  `modelence dev [args...]`, keyed on modelence.config.json like `modelence
  deploy`. Having one makes a modern app: its dev command runs with the
  connected environment's variables, the same for every app, Modelence
  framework or not. Without one it is a legacy Modelence framework app, which
  keeps starting the framework dev server with its own environment, as before.

  A framework app with a config keeps `"dev": "modelence dev"`, so its dev
  command lands here again: that nested run starts the framework dev server,
  whose environment the outer run already merged the variables into, and
  never runs the dev command again, so it cannot loop.
*/
export async function dev(options: DevOptions, args: string[], cwd: string = process.cwd()) {
  let spec: AppSpec | null;
  try {
    spec = await readAppSpecFile(cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (spec && !isInsideDevCommand()) {
    // A framework app's server reads it from the environment.
    await runDevCommand(spec, args, cwd, options.takeover ? { MODELENCE_TAKEOVER: '1' } : {});
    return;
  }

  if (args.length > 0) {
    console.warn(`Ignoring arguments for the Modelence dev server: ${args.join(' ')}`);
  }
  await loadEnv();
  startFrameworkDevServer(options);
}

export function startFrameworkDevServer(options: DevOptions) {
  console.log('Starting Modelence dev server...');

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    ...(options.takeover ? { MODELENCE_TAKEOVER: '1' } : {}),
  };

  const child =
    process.platform === 'win32'
      ? // tsx is a .CMD shim on Windows, so it still needs a shell to launch.
        spawnProcessTree(
          `"${tsxPath}" watch --ignore "vite.config.ts.timestamp-*" "${serverPath}"`,
          [],
          { cwd: process.cwd(), env, shell: true }
        )
      : spawnProcessTree(tsxPath, ['watch', '--ignore', 'vite.config.ts.timestamp-*', serverPath], {
          cwd: process.cwd(),
          env,
          shell: false,
        });

  child.on('error', (error) => {
    console.error('Failed to start the dev server:', error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}
