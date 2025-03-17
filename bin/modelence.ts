#!/usr/bin/env node

import { Command } from 'commander';
import { setup } from './setup';
import { build } from './build';
import { deploy } from './deploy';
import { dev } from './dev';
import { createApp } from './create-app';
import { loadEnv } from './config';

const program = new Command()
  .name('modelence')
  .description('Modelence CLI tool')
  .version('0.2.1');

// Commands that don't need config
program
  .command('create-app <project-name>')
  .description('Create a new Modelence application')
  .option('-t, --template <template-name>', 'Template to use (from examples repository)')
  .action(async (projectName, options) => {
    await createApp(projectName, {
      template: options.template
    });
  });

program
  .command('setup')
  .description('Setup Modelence environment variables')
  .requiredOption('-t, --token <token>', 'Modelence setup token')
  .option('-h, --host <host>', 'Modelence host', 'https://cloud.modelence.com')
  .action(async (options) => {
    await setup(options);
  });

// Commands that need config
const configCommands = program
  .command('project')
  .description('Project management commands');

configCommands
  .command('build')
  .description('Build the application')
  .action(async () => {
    await loadEnv();
    await build();
  });

configCommands
  .command('deploy')
  .description('Deploy to Modelence Cloud')
  .requiredOption('-e, --env <env>', 'Environment (deployment alias)')
  .action(async (options) => {
    await loadEnv();
    await deploy(options);
  });

configCommands
  .command('dev')
  .description('Start development server')
  .action(async () => {
    await loadEnv();
    dev();
  });

program.parse(process.argv);
