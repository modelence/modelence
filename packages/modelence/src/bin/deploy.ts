import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { authenticateCli } from './auth';
import { getStudioUrl, getBuildPath, getProjectPath } from './config';
import { build } from './build';

export async function deploy(options: { app: string; env: string }) {
  const cwd = process.cwd();
  const modelenceDir = join(cwd, '.modelence');

  const bundlePath = join(modelenceDir, 'tmp', 'bundle.zip');

  await build();

  await createBundle(bundlePath);

  const { token } = await authenticateCli();

  const { bundleName } = await uploadBundle(options.app, options.env, bundlePath, token);

  await fs.unlink(bundlePath);

  await triggerDeployment(options.app, options.env, bundleName, join('.modelence', 'build', 'app.mjs'), token);
}

async function createBundle(bundlePath: string) {
  try {
    await fs.unlink(bundlePath);
    console.log('Removed existing bundle');
  } catch (error) {
    // Ignore error if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  console.log('Creating deployment bundle...');

  await fs.mkdir(join(bundlePath, '..'), { recursive: true });

  const output = createWriteStream(bundlePath);
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

  const bundleFiles = [
    'package.json',
    'next.config.js',
    'next.config.ts',
    'modelence.config.ts',
  ];

  const bundleDirs = [
    'public',
    'server',
    join('.modelence', 'build'),
    '.next',
  ];

  for (const file of bundleFiles) {
    if (await fs.access(getProjectPath(file)).then(() => true).catch(() => false)) {
      archive.file(getProjectPath(file), { name: file });
    }
  }

  for (const dir of bundleDirs) {
    if (await fs.access(getProjectPath(dir)).then(() => true).catch(() => false)) {
      archive.directory(getProjectPath(dir), dir);
    }
  }

  await archive.finalize();
  await archiveComplete;

  const stats = await fs.stat(bundlePath);
  console.log(`Deployment bundle created at: ${bundlePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

async function uploadBundle(appAlias: string, envAlias: string, bundlePath: string, token: string) {
  const response = await fetch(getStudioUrl(`/api/upload`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      appAlias,
      envAlias,
    }),
  });

  if (!response.ok) {
    console.error(await response.text());
    throw new Error(`Failed to create upload URL: ${response.statusText}`);
  }

  const { uploadUrl, bundleName } = await response.json();

  const fileBuffer = await fs.readFile(bundlePath);
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

async function triggerDeployment(appAlias: string, envAlias: string, bundleName: string, entryPoint: string, token: string) {
  const response = await fetch(getStudioUrl(`/api/deploy`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      appAlias,
      envAlias,
      bundleName,
      entryPoint,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger deployment: ${response.statusText}`);
  }

  const { deploymentUrl } = await response.json();

  console.log('Successfully triggered deployment');
  console.log(`Follow your deployment progress at: ${deploymentUrl}`);
}
