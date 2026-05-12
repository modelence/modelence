import fs from 'fs/promises';
import {
  getBuildPath,
  getConfig,
  getModelencePath,
  getPostBuildCommand,
  getServerPath,
} from './config';
import { build as tsupBuild } from 'tsup';
import { build as viteBuild, mergeConfig, loadConfigFromFile } from 'vite';
import path from 'path';
import { execSync } from 'child_process';

async function buildClient() {
  const postBuildCommand = getPostBuildCommand();
  if (postBuildCommand) {
    console.log('Running post-build command...');
    execSync(postBuildCommand);
    return;
  }

  const ssrEnabled = Boolean(getConfig().ssr);

  await buildVite({ ssr: ssrEnabled });

  if (ssrEnabled) {
    await buildViteSsr();
  }
}

async function buildVite({ ssr }: { ssr: boolean }) {
  console.log('Building client with Vite...');

  const userConfig = await loadConfigFromFile({
    command: 'build',
    mode: process.env.NODE_ENV || 'production',
  });

  const modelenceConfig = {
    build: {
      outDir: path.resolve(process.cwd(), '.modelence/build/client').replace(/\\/g, '/'),
      emptyOutDir: true,
      // Emit `.vite/ssr-manifest.json` so the SSR runtime can map rendered
      // modules to their CSS assets (see ssr/collectCss.ts:loadProdCssAssets).
      ssrManifest: ssr,
    },
  };

  await viteBuild(mergeConfig(userConfig?.config || {}, modelenceConfig, true));
}

async function buildViteSsr() {
  console.log('Building SSR bundle with Vite...');

  const userConfig = await loadConfigFromFile({
    command: 'build',
    mode: process.env.NODE_ENV || 'production',
  });

  const ssrEntry = path.resolve(process.cwd(), 'src/client/index.tsx').replace(/\\/g, '/');
  const modelenceConfig = {
    build: {
      ssr: ssrEntry,
      outDir: path.resolve(process.cwd(), '.modelence/build/ssr').replace(/\\/g, '/'),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          format: 'esm' as const,
          entryFileNames: 'index.mjs',
        },
      },
    },
  };

  await viteBuild(mergeConfig(userConfig?.config || {}, modelenceConfig, true));
}

async function buildServer() {
  console.log('Building server with tsup...');
  return new Promise((resolve) => {
    tsupBuild({
      entry: [getServerPath()],
      format: 'esm',
      sourcemap: true,
      minify: process.env.NODE_ENV === 'production',
      outDir: '.modelence/build',
      clean: true,
      watch: false,
      bundle: true,
      skipNodeModulesBundle: true,
      treeshake: true,
      platform: 'node',
      outExtension: () => ({
        js: '.mjs',
      }),
      onSuccess: async () => {
        resolve(undefined);
      },
    });
  });
}

export async function build() {
  console.log('Building Modelence project...');

  try {
    const buildDir = getBuildPath();
    await fs.rm(buildDir, { recursive: true, force: true });

    await buildServer();
    await buildClient();

    console.log('Build completed successfully!');
  } catch (error) {
    console.error(error);
    throw new Error('Build failed');
  }

  try {
    await fs.access(getModelencePath());
  } catch {
    throw new Error(
      'Could not find the .modelence directory. Looks like something went wrong during the build.'
    );
  }
}
