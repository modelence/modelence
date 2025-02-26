import { execSync } from 'child_process';
import { getServerPath } from './config';
import { build as tsupBuild } from 'tsup';

export function dev() {
  tsupBuild({
    entry: [getServerPath()],
    format: 'esm',
    outDir: '.modelence/dev',
    clean: true,
    watch: true,
    bundle: true,
    minify: false,
    sourcemap: true,
    treeshake: false,
    skipNodeModulesBundle: true,
    outExtension: ({ format }) => ({
      js: '.mjs'
    }),
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
