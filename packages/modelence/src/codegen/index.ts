import { promises as fs } from 'fs';
import * as path from 'path';
import { analyzeModulesFromServerFile } from './astAnalyzer';
import { generateZustandStores, generateIndexFile } from './zustandGenerator';

export interface CodegenOptions {
  /**
   * Path to the server entry file
   * By default, uses the serverPath from modelence.config.ts
   */
  serverPath?: string;

  /**
   * Output directory for generated stores
   * Default: .modelence/stores
   */
  outputDir?: string;
}

/**
 * Main code generation function
 * This is called during `modelence dev` and `modelence build`
 */
export async function generateStores(options: CodegenOptions = {}) {
  const {
    serverPath = await findServerPath(),
    outputDir = path.join(process.cwd(), '.modelence/stores'),
  } = options;

  console.log('🔄 Generating zustand stores from modules...');

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Analyze modules using AST parsing (no code execution)
    console.log(`   Analyzing modules from: ${serverPath}`);
    const modules = await analyzeModulesFromServerFile(serverPath);

    if (modules.length === 0) {
      console.log('   ⚠️  No modules found. Skipping store generation.');
      return;
    }

    console.log(`   Found ${modules.length} module(s): ${modules.map((m) => m.name).join(', ')}`);

    // Generate stores
    const stores = generateZustandStores(modules);

    // Write store files
    for (const store of stores) {
      const storePath = path.join(outputDir, store.fileName);
      await fs.writeFile(storePath, store.content, 'utf-8');
      console.log(`   ✓ Generated: ${store.fileName}`);
    }

    // Generate index file
    const indexContent = generateIndexFile(modules);
    const indexPath = path.join(outputDir, 'index.ts');
    await fs.writeFile(indexPath, indexContent, 'utf-8');
    console.log(`   ✓ Generated: index.ts`);

    console.log('✅ Zustand stores generated successfully!\n');
    console.log(`   Import them in your client code:`);
    console.log(
      `   import { use${toPascalCase(modules[0].name)}Store } from '.modelence/stores';\n`
    );
  } catch (error) {
    console.error('❌ Failed to generate zustand stores:', error);
    throw error;
  }
}

/**
 * Find the server entry file in the user's project
 * This should be the file that calls startApp()
 */
async function findServerPath(): Promise<string> {
  // Try to read from modelence.config.ts
  try {
    const configPath = path.join(process.cwd(), 'modelence.config.ts');
    const configContent = await fs.readFile(configPath, 'utf-8');

    // Simple regex to extract serverDir and serverEntry
    const serverDirMatch = configContent.match(/serverDir:\s*['"](.+?)['"]/);
    const serverEntryMatch = configContent.match(/serverEntry:\s*['"](.+?)['"]/);

    if (serverDirMatch && serverEntryMatch) {
      const serverPath = path.join(process.cwd(), serverDirMatch[1], serverEntryMatch[1]);
      await fs.access(serverPath);
      return serverPath;
    }
  } catch {
    // Config not found or parse failed, try defaults
  }

  // Fallback to common paths
  const possiblePaths = [
    path.join(process.cwd(), 'src/server/app.ts'),
    path.join(process.cwd(), 'src/server/index.ts'),
    path.join(process.cwd(), 'server/app.ts'),
    path.join(process.cwd(), 'server/index.ts'),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // File doesn't exist, continue
    }
  }

  throw new Error(
    'Could not find server entry file. Make sure your modelence.config.ts is configured correctly.'
  );
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export * from './astAnalyzer';
export * from './zustandGenerator';
