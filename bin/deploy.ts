import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';

export async function deploy(options: {} = {}) {
  const cwd = process.cwd();
  const modelenceDir = join(cwd, '.modelence');
  const outputFile = join(modelenceDir, 'bundle.zip');

  // Verify .modelence directory exists
  try {
    await fs.access(modelenceDir);
  } catch (error) {
    throw new Error('Could not find .modelence directory. Please build your project first.');
  }

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

  // TODO: Add authentication
  const deploymentId = '677d93fe2cdf304863f3a0f6';
  const response = await fetch(`http://localhost:3000/api/deployments/${deploymentId}/deploy`, {
    method: 'POST',
    headers: {
    },
  });
  const { uploadUrl } = await response.json();

  console.log('uploadUrl', uploadUrl);

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
}
