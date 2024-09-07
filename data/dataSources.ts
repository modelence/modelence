import fs from 'fs';
import path from 'path';
import { DataSource } from './types';

export async function loadModels() {
  const dataSources: Record<string, DataSource<any>> = {};

  const modelsPath = path.join(process.cwd(), 'src', 'server', 'models');
  
  try {
    const files = await fs.promises.readdir(modelsPath);
    
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        const filePath = path.join(modelsPath, file);
        const dataSource = (await import(filePath)).default;
        dataSources[dataSource.collectionName] = dataSource;
      }
    }
    
    console.log('All model files imported successfully');
    return dataSources;
  } catch (error) {
    console.error('Error importing model files:', error);
    throw error;
  }
}
