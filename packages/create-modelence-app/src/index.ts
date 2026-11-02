#!/usr/bin/env node

import { Command } from 'commander';
import { createApp } from './create-app';

const program = new Command()
  .name('create-modelence-app')
  .description('Create a new Modelence application')
  .argument('<project-name>', 'Name of the project')
  .action(async (projectName) => {
    await createApp(projectName);
  });

program.parse(process.argv); 