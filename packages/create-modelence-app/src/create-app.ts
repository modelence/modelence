import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';

const EXAMPLES_REPO_URL = 'https://github.com/modelence/examples.git';
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

  // Clone the examples repo to a temp directory
  const tempDir = path.resolve(process.cwd(), `.temp-modelence-examples-${Date.now()}`);
  try {
    console.log('Cloning examples repository...');
    execSync(`git clone --depth 1 ${EXAMPLES_REPO_URL} ${tempDir}`, { stdio: 'inherit' });

    const templatePath = path.join(tempDir, template);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template "${template}" not found in examples repository`);
    }

    // Copy template files to project directory
    fs.copySync(templatePath, projectPath);

    // Clean up temp directory
    fs.removeSync(tempDir);

    // Update package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.name = projectName;
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    }

    // Install dependencies
    console.log('Installing dependencies...');
    execSync('npm install', { cwd: projectPath, stdio: 'inherit' });

    console.log(`\nSuccessfully created ${projectName}!\n\nGet started by typing:\n\n  cd ${projectName}\n  npm run dev\n    `);
  } catch (error: any) {
    // Clean up on error
    if (fs.existsSync(projectPath)) {
      fs.removeSync(projectPath);
    }
    // Clean up temp dir if exists
    if (fs.existsSync(tempDir)) {
      fs.removeSync(tempDir);
    }
    throw error;
  }
}