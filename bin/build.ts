import fs from 'fs/promises';
import { getBuildPath, getModelencePath, getPostBuildCommand, getProjectPath, getServerPath } from './config';
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
      outDir: path.resolve(process.cwd(), '.modelence/build/client'),
      emptyOutDir: true
    }
  };

  await viteBuild(mergeConfig(
    userConfig?.config || {},
    modelenceConfig,
    true
  ));
}

async function buildServer() {
  console.log('Building server with tsup...');
  return new Promise((resolve, reject) => {
    tsupBuild({
      entry: [getServerPath()],
      format: 'esm',
      outDir: '.modelence/build',
      clean: true,
      watch: false,
      bundle: true,
      treeshake: true,
      skipNodeModulesBundle: false,
      outExtension: ({ format }) => ({
        js: '.mjs'
      }),
      onSuccess: async () => { resolve(undefined); }
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

    await fs.copyFile(getProjectPath('package.json'), getBuildPath('package.json'));
    
    console.log('Build completed successfully!');
  } catch (error) {
    console.error(error);
    throw new Error('Build failed');
  }


  try {
    await fs.access(getModelencePath());
  } catch (error) {
    throw new Error('Could not find the .modelence directory. Looks like something went wrong during the build.');
  }
}
