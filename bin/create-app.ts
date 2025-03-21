import { Octokit } from '@octokit/rest';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';

const EXAMPLES_REPO = 'modelence/examples';
const DEFAULT_TEMPLATE = 'empty-project';

interface CreateAppOptions {
  template?: string;
}

export async function createApp(projectName: string, options: CreateAppOptions = {}) {
  const template = options.template || DEFAULT_TEMPLATE;
  
  console.log(`Creating new Modelence app: ${projectName}`);
  console.log(`Using template: ${template}`);

  // Validate project name
  if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
    throw new Error('Project name can only contain letters, numbers, dashes and underscores');
  }

  const projectPath = path.resolve(process.cwd(), projectName);

  // Check if directory already exists
  if (fs.existsSync(projectPath)) {
    throw new Error(`Directory ${projectName} already exists`);
  }

  try {
    // Initialize Octokit
    const octokit = new Octokit();

    // Get template contents from GitHub
    const response = await octokit.repos.getContent({
      owner: 'modelence',
      repo: 'examples',
      path: template,
    });

    if (!Array.isArray(response.data)) {
      throw new Error('Invalid template structure');
    }

    // Create project directory
    fs.mkdirSync(projectPath);

    // Download and extract template files
    await downloadTemplateFiles(octokit, response.data, template, projectPath);

    // Update package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = projectName;
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Install dependencies
    console.log('Installing dependencies...');
    execSync('npm install', { cwd: projectPath, stdio: 'inherit' });

    console.log(`
Successfully created ${projectName}!

Get started by typing:

  cd ${projectName}
  npm run dev
    `);

  } catch (error: any) {
    // Clean up on error
    if (fs.existsSync(projectPath)) {
      fs.removeSync(projectPath);
    }

    if (error.status === 404) {
      throw new Error(`Template "${template}" not found in ${EXAMPLES_REPO}`);
    }
    throw error;
  }
}

async function downloadTemplateFiles(octokit: Octokit, contents: any[], templateName: string, targetPath: string) {
  for (const item of contents) {
    const itemPath = path.join(targetPath, item.name);

    if (item.type === 'dir') {
      fs.mkdirSync(itemPath);
      const dirContents = await octokit.repos.getContent({
        owner: 'modelence',
        repo: 'examples',
        path: `${templateName}/${item.name}`,
      });
      if (Array.isArray(dirContents.data)) {
        await downloadTemplateFiles(octokit, dirContents.data, `${templateName}/${item.name}`, itemPath);
      }
    } else {
      const fileContent = await octokit.repos.getContent({
        owner: 'modelence',
        repo: 'examples',
        path: `${templateName}/${item.name}`,
      });
      
      if ('content' in fileContent.data && typeof fileContent.data.content === 'string') {
        const content = Buffer.from(fileContent.data.content, 'base64').toString();
        await fs.writeFile(itemPath, content);
      }
    }
  }
} 