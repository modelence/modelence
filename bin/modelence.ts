#!/usr/bin/env node

import { Command } from 'commander';
import { setup } from './setup';
import { deploy } from './deploy';
const program = new Command()
  .name('modelence')
  .description('Modelence CLI tool')
  .version('0.2.1');

program
  .command('setup')
  .description('Setup Modelence environment variables')
  .option('-t, --token <token>', 'Modelence setup token')
  .option('-h, --host <host>', 'Modelence host', 'https://cloud.modelence.com')
  .action(async (options) => {
    await setup(options);
  });

program
  .command('deploy')
  .description('Deploy your Modelence application')
  // .option('-e, --environment <env>', 'Deployment environment', 'production')
  .action(async (options) => {
    await deploy(options);
  });

program.parse(process.argv);

