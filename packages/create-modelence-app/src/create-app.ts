import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

const TEMPLATE_REPO_ZIP_URL =
  'https://github.com/modelence/app-builder-empty-project/archive/refs/heads/main.zip';

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

  // Download and extract the template repo
  const tempDir = path.resolve(process.cwd(), `.temp-modelence-template-${Date.now()}`);
  const zipPath = path.join(tempDir, 'template.zip');
  
  try {
    // Create temp directory
    fs.ensureDirSync(tempDir);

    const response = await fetch(TEMPLATE_REPO_ZIP_URL);
    if (!response.ok) {
      throw new Error(`Failed to download template: ${response.statusText}`);
    }
    
    // Save zip file
    const zipArrayBuffer = await response.arrayBuffer();
    const zipBuffer = Buffer.from(zipArrayBuffer);
    fs.writeFileSync(zipPath, zipBuffer);
    
    // Extract zip
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    
    // Find the extracted directory (GitHub adds a folder name like "app-builder-empty-project-main")
    const extractedDirs = fs.readdirSync(tempDir).filter(item => 
      fs.statSync(path.join(tempDir, item)).isDirectory() && item !== '__MACOSX'
    );
    
    if (extractedDirs.length === 0) {
      throw new Error('The template is not found');
    }
    
    const templatePath = path.join(tempDir, extractedDirs[0]);

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