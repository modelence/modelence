#!/usr/bin/env node

import { Command, Option } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setup } from './setup';
import { build } from './build';
import { deploy } from './deploy';
import { dev } from './dev';
import { run } from './run';
import { loadLocalEnv } from './localEnv';
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
  .version(packageJson.version)
  // Lets `run` pass flags like `--port` through to the script untouched.
  .enablePositionalOptions();

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
    'Deploy the project described by modelence.config.json to Modelence Cloud (picks the target in the browser; in CI from --app/--env or the saved target)'
  )
  .option('-a, --app <app>', 'Application alias (preselected in the browser; the target in CI)')
  .option('-e, --env <env>', 'Environment alias (preselected in the browser; the target in CI)')
  .option('-h, --host <host>', 'Modelence host')
  .option(
    '--prebuilt',
    'Build locally and upload the .modelence/build bundle (Modelence apps only)'
  )
  .option(
    '--skip-env-check',
    'In CI, deploy even when variables modelence.config.json requires have no value'
  )
  // Nothing asks for confirmation any more; still accepted so scripts keep working.
  .addOption(new Option('-y, --yes').hideHelp())
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
  .description('Create a modelence.config.json template for this project')
  .option('--force', 'Overwrite an existing modelence.config.json')
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
    dev(options, await loadLocalEnv());
  });

program
  .command('run')
  .description(
    "Run a package.json script (or any command) with the connected environment's variables"
  )
  .argument('<script>', 'Script name from package.json, or a command')
  .argument('[args...]', 'Arguments passed on to the script')
  .helpOption(false)
  .allowUnknownOption()
  .passThroughOptions()
  .action(async (script: string, args: string[]) => {
    await run(script, args);
  });

program
  .command('start')
  .description('Start production server')
  .action(async () => {
    await loadEnv();
    start();
  });

program.parse(process.argv);
