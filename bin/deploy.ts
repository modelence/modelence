import { createWriteStream, promises as fs } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import archiver from 'archiver';
import { authenticateCli } from './auth';
import { getStudioUrl } from './config';

// TODO: Determine dynamically
const deploymentId = '677d93fe2cdf304863f3a0f6';

export async function deploy(options: {} = {}) {
  const cwd = process.cwd();
  const modelenceDir = join(cwd, '.modelence');

  const outputFile = join(modelenceDir, 'bundle.zip');

  await buildProject(modelenceDir);

  await createBundle(modelenceDir, outputFile);

  const { token } = await authenticateCli();

  const { bundleName } = await uploadBundle(outputFile, token);

  await triggerDeployment(bundleName, token);
}

async function buildProject(modelenceDir: string) {
  console.log('Building project...');
  
  try {
    execSync('npm run build', {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
  } catch (error) {
    console.error(error);
    throw new Error('Build failed');
  }

  // Verify .modelence directory exists
  try {
    await fs.access(modelenceDir);
  } catch (error) {
    throw new Error('Could not find .modelence directory. Looks like something went wrong during the build.');
  }
}

async function createBundle(modelenceDir: string, outputFile: string) {
  try {
    await fs.unlink(outputFile);
    console.log('Removed existing bundle');
  } catch (error) {
    // Ignore error if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  console.log('Creating deployment bundle...');

  const output = createWriteStream(outputFile);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('Warning:', err);
    } else {
      throw err;
    }
  });

  archive.on('error', (err) => {
    throw err;
  });

  const archiveComplete = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  archive.directory(join(modelenceDir, 'build'), 'bundle');

  await archive.finalize();
  await archiveComplete;

  const stats = await fs.stat(outputFile);
  console.log(`Deployment bundle created at: ${outputFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

async function uploadBundle(outputFile: string, token: string) {
  const response = await fetch(getStudioUrl(`/api/deployments/${deploymentId}/upload`), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const { uploadUrl, bundleName } = await response.json();

  const fileBuffer = await fs.readFile(outputFile);
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileBuffer,
    headers: {
      'Content-Type': 'application/zip',
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload bundle: ${uploadResponse.statusText}`);
  }

  console.log('Successfully uploaded bundle to Modelence Cloud');
  console.log(`Bundle name: ${bundleName}`);

  return { bundleName };
}

async function triggerDeployment(bundleName: string, token: string) {
  const response = await fetch(getStudioUrl(`/api/deployments/${deploymentId}/deploy`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      bundleName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger deployment: ${response.statusText}`);
  }

  const { deploymentUrl } = await response.json();

  console.log('Successfully triggered deployment');
  console.log(`Follow your deployment progress at: ${deploymentUrl}`);
}
