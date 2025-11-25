import fs from 'fs/promises';
import { getBuildPath, getModelencePath, getPostBuildCommand, getServerPath } from './config';
import { build as tsupBuild } from 'tsup';
import { build as viteBuild, mergeConfig, loadConfigFromFile } from 'vite';
import path from 'path';
import { execSync } from 'child_process';
import pkg from '../../package.json';
import { generateStores } from '../codegen';

async function buildClient() {
  const postBuildCommand = getPostBuildCommand();
  if (postBuildCommand) {
    console.log('Running post-build command...');
    execSync(postBuildCommand);
    return;
  }

  await buildVite();
}

async function buildVite() {
  console.log('Building client with Vite...');

  const userConfig = await loadConfigFromFile({
    command: 'build',
    mode: process.env.NODE_ENV || 'production',
  });

  const modelenceConfig = {
    build: {
      outDir: path.resolve(process.cwd(), '.modelence/build/client').replace(/\\/g, '/'),
      emptyOutDir: true,
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
      treeshake: true,
      platform: 'node',
      external: [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ],
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

    // Generate zustand stores before building
    console.log('\n🔧 Generating zustand stores...');
    try {
      await generateStores();
    } catch (error) {
      console.warn('\n⚠️  Store generation failed, continuing anyway...');
      console.warn(error);
    }

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
