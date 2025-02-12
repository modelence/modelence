import { Octokit } from '@octokit/rest';
import fs from 'fs-extra';
import path from 'path';
import { download } from './utils';

interface DownloadOptions {
  template: string;
  projectName: string;
  token?: string;
}

export async function downloadTemplate({ template, projectName, token }: DownloadOptions) {
  const octokit = new Octokit({ auth: token });
  
  try {
    // Check if directory exists
    if (fs.existsSync(projectName)) {
      throw new Error(`Directory ${projectName} already exists`);
    }

    const templatePath = `examples/${template}`;
    
    // Download from GitHub
    await download({
      owner: 'modelence',
      repo: 'examples',
      path: templatePath,
      destination: projectName,
      octokit,
    });

  } catch (error) {
    throw new Error(`Failed to download template: ${error.message}`);
  }
} 