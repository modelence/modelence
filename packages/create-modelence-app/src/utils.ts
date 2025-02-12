import { Octokit } from '@octokit/rest';
import fs from 'fs-extra';
import path from 'path';

interface DownloadOptions {
  owner: string;
  repo: string;
  path: string;
  destination: string;
  octokit: Octokit;
}

export async function download({ owner, repo, path: repoPath, destination, octokit }: DownloadOptions) {
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: repoPath,
  });

  if (!Array.isArray(response.data)) {
    throw new Error('Expected directory content');
  }

  await fs.ensureDir(destination);

  for (const item of response.data) {
    const itemPath = path.join(destination, item.name);
    
    if (item.type === 'dir') {
      await download({
        owner,
        repo,
        path: item.path,
        destination: itemPath,
        octokit,
      });
    } else if (item.type === 'file') {
      const fileContent = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: item.path,
      });
      
      if ('content' in fileContent.data) {
        const content = Buffer.from(fileContent.data.content, 'base64');
        await fs.writeFile(itemPath, content);
      }
    }
  }
} 