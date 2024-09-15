import path from 'path';
import { glob } from 'glob';

export async function loadModules(pattern: string) {
  const srcPath = path.join(process.cwd(), 'src');
  const files = await glob(pattern, { cwd: srcPath });

  try {
    return Promise.all(files.map(async file => {
      const filePath = path.join(srcPath, file);
      console.log(`Importing module: ${file}`);
      return (await import(filePath)).default;
    }));
  } catch (error) {
    console.error('Error importing module files:', error);
    throw error;
  }
}
