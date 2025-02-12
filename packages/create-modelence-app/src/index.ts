#!/usr/bin/env node
import { program } from 'commander';
import { downloadTemplate } from './download';
import { setupProject } from './setup';

program
  .name('create-modelence-app')
  .description('Create a new Modelence application')
  .argument('<project-name>', 'name of the project')
  .option('--token <token>', 'GitHub personal access token')
  .option('--template <template>', 'template to use (default: empty-project)')
  .action(async (projectName: string, options: { token?: string, template?: string }) => {
    try {
      const template = options.template || 'empty-project';
      await downloadTemplate({
        template,
        projectName,
        token: options.token,
      });
      await setupProject(projectName);
      
      console.log(`
✨ Project ${projectName} created successfully!

To get started:
  cd ${projectName}
  npm install
  npm run dev
      `);
    } catch (error) {
      console.error('Failed to create project:', error);
      process.exit(1);
    }
  });

program.parse(process.argv); 