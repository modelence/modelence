import { join } from 'path';
import { execSync } from 'child_process';
import { getConfig } from './config';
import { build } from 'tsup';

export function dev() {
  const { serverDir, serverEntry } = getConfig();
  const serverPath = join(serverDir, serverEntry);
  // execSync(`tsx ${serverPath}`, { stdio: 'inherit' });

  build({
    entry: [serverPath],
    format: 'esm',
    outDir: '.modelence/dev',
    clean: true,
    watch: true,
    onSuccess: async () => {
      // Restart the server on successful builds
      try {
        execSync('node .modelence/dev/app.js', {
          stdio: 'inherit',
          env: {
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
