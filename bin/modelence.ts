#!/usr/bin/env node

import { Command } from 'commander';
import { setup } from './setup';
import { build } from './build';
import { deploy } from './deploy';
import { dev } from './dev';
import { loadEnv } from './config';

const program = new Command()
  .name('modelence')
  .description('Modelence CLI tool')
  .version('0.2.1');

program
  .command('setup')
  .description('Setup Modelence environment variables')
  .requiredOption('-t, --token <token>', 'Modelence setup token')
  .option('-h, --host <host>', 'Modelence host', 'https://cloud.modelence.com')
  .action(async (options) => {
    await setup(options);
  });

program
  .command('build')
  .description('Build the application')
  .action(async () => {
    await build();
  });

program
  .command('deploy')
  .description('Deploy to Modelence Cloud')
  .requiredOption('-e, --env <env>', 'Environment (deployment alias)')
  .action(async (options) => {
    await deploy(options);
  });

program
  .command('dev')
  .description('Start development server')
  .action(async () => {
    dev();
  });

loadEnv().then(() => {
  program.parse(process.argv);
});
