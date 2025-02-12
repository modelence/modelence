import fs from 'fs-extra';
import path from 'path';

export async function setupProject(projectName: string) {
  const projectPath = path.resolve(process.cwd(), projectName);
  const packageJsonPath = path.join(projectPath, 'package.json');

  try {
    // Update package.json
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = projectName;
    packageJson.version = '0.1.0';
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Create .env file if it doesn't exist
    const envPath = path.join(projectPath, '.env');
    if (!fs.existsSync(envPath)) {
      await fs.writeFile(envPath, '# Environment variables\n');
    }

  } catch (error) {
    throw new Error(`Failed to setup project: ${error.message}`);
  }
} 