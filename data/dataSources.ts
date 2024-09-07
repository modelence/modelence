import fs from 'fs';
import path from 'path';

const dataSources: Record<string, any> = {};

export async function loadModels() {
  const modelsPath = path.join(process.cwd(), 'src', 'server', 'models');
  
  try {
    const files = await fs.promises.readdir(modelsPath);
    
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        const filePath = path.join(modelsPath, file);
        const dataSource = await import(filePath);
        dataSources[dataSource.collectionName] = dataSource;
      }
    }
    
    console.log('All model files imported successfully');
  } catch (error) {
    console.error('Error importing model files:', error);
  }
}
