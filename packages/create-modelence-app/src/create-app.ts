import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { downloadTemplate } from 'giget';

// Use GitHub's archive URL rather than giget's `github:` provider, which goes through
// api.github.com and is limited to 60 unauthenticated requests per hour per IP
const TEMPLATE_SOURCE =
  'https://github.com/modelence/app-builder-empty-project/archive/refs/heads/main.tar.gz';

export async function createApp(projectName: string) {
  console.log(`Creating new Modelence app: ${projectName}`);

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
    await downloadTemplate(TEMPLATE_SOURCE, { dir: projectPath });

    // Update package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.name = projectName;
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    }

    // Install dependencies
    execSync('npm install', { cwd: projectPath, stdio: 'inherit' });

    console.log(`\nSuccessfully created ${projectName}!\n\nGet started by typing:\n\n  cd ${projectName}\n  npm run dev\n    `);
  } catch (error: any) {
    // Clean up on error
    if (fs.existsSync(projectPath)) {
      fs.removeSync(projectPath);
    }
    throw error;
  }
}