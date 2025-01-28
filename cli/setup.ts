#!/usr/bin/env node
import { Command } from 'commander';
import { setupCommand } from './commands/setup';

const program = new Command();

program
  .name('modelence')
  .description('Modelence CLI tools')
  .version('0.1.0');

program.addCommand(setupCommand);

program.parse();