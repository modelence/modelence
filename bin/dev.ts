import { join } from 'path';
import { execSync } from 'child_process';
import { getConfig } from './config';
import { build } from 'tsup';

export function dev() {
  const { serverDir, serverEntry } = getConfig();
  const serverPath = join(serverDir, serverEntry);

  build({
    entry: [serverPath],
    format: 'esm',
    outDir: '.modelence/dev',
    clean: true,
    watch: true,
    bundle: false,
    splitting: false,
    treeshake: false,
    skipNodeModulesBundle: true,
    onSuccess: async () => {
      // Restart the server on successful builds
      try {
        execSync('node .modelence/dev/app.mjs', {
          stdio: 'inherit',
          env: {
            ...process.env,
            NODE_ENV: 'development' 
          }
        });
      } catch (error) {
        // Server crashed, waiting for next rebuild
        console.error('Server crashed:', error);
      }
    }
  });
}
