#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setup } from './setup';
import { build } from './build';
import { deploy } from './deploy';
import { dev } from './dev';
import { start } from './start';
import { logout } from './logout';
import { init } from './init';
import { loadEnv } from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command()
  .name('modelence')
  .description('Modelence CLI tool')
  .version(packageJson.version);

program
  .command('setup')
  .description('Setup Modelence environment variables')
  .option('-t, --token <token>', 'Modelence setup token (omit to authorize in the browser)')
  .option('-h, --host <host>', 'Modelence host', 'https://cloud.modelence.com')
  .action(async (options) => {
    await setup(options);
  });

program
  .command('build')
  .description('Build the application')
  .action(async () => {
    await loadEnv();
    await build();
  });

program
  .command('deploy')
  .description(
    'Deploy the current directory to Modelence Cloud (any Node.js app; picks the target in the browser on first run)'
  )
  .option('-a, --app <app>', 'Application alias')
  .option('-e, --env <env>', 'Environment alias')
  .option('-h, --host <host>', 'Modelence host')
  .option(
    '--prebuilt',
    'Build locally and upload the .modelence/build bundle (Modelence apps only)'
  )
  .option('--runtime <runtime>', 'node or modelence (default: from modelence.json or detected)')
  .option('--node-version <version>', 'Node.js version for the container, e.g. 22')
  .option('--root-dir <path>', 'Subdirectory containing the app (monorepos)')
  .option('--install-command <command>', 'Install command for this deploy')
  .option('--build-command <command>', 'Build command for this deploy ("" to skip)')
  .option('--start-command <command>', 'Start command for this deploy')
  .option(
    '--static <path=dir>',
    'Serve a built directory at a URL path, e.g. /=client/dist (repeatable)',
    (value: string, previous: string[] = []) => [...previous, value]
  )
  .action(async (options) => {
    try {
      await deploy(options);
    } catch (error) {
      console.error(`Deploy failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Detect how this project builds and runs, and write it to modelence.json')
  .option('--root-dir <path>', 'Subdirectory containing the app (monorepos)')
  .option('--force', 'Overwrite an existing modelence.json')
  .option('-h, --host <host>', 'Modelence host used for the schema URL')
  .action(async (options) => {
    try {
      await init(options);
    } catch (error) {
      console.error(`Init failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Forget the saved Modelence Cloud login')
  .option('-h, --host <host>', 'Only forget the login for this host')
  .action(async (options) => {
    await logout(options);
  });

program
  .command('dev')
  .description('Start development server')
  .option(
    '--takeover',
    'Disconnect any instance currently holding the environment and connect this one'
  )
  .action(async (options) => {
    await loadEnv();
    dev(options);
  });

program
  .command('start')
  .description('Start production server')
  .action(async () => {
    await loadEnv();
    start();
  });

program.parse(process.argv);
