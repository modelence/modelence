#!/usr/bin/env node

import { Command } from 'commander';
import { createApp } from './create-app';

const program = new Command()
  .name('create-modelence-app')
  .description('Create a new Modelence application')
  .argument('<project-name>', 'Name of the project')
  .option('-t, --template <template-name>', 'Template to use (from examples repository)')
  .action(async (projectName, options) => {
    await createApp(projectName, {
      template: options.template
    });
  });

program.parse(process.argv); 