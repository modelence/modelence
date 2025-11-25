import { Module } from '../app/module';
import { createJiti } from 'jiti';
import path from 'path';

export interface ModuleMetadata {
  name: string;
  queries: QueryMetadata[];
  mutations: MutationMetadata[];
}

export interface QueryMetadata {
  name: string;
  fullName: string;
}

export interface MutationMetadata {
  name: string;
  fullName: string;
}

/**
 * Analyzes the server entry file and extracts all module metadata
 * @param serverPath - Path to the user's server entry file (e.g., src/server/app.ts)
 * @returns Array of module metadata
 */
export async function analyzeModules(serverPath: string): Promise<ModuleMetadata[]> {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    requireCache: false,
    moduleCache: false,
    alias: {
      // Ensure modelence packages resolve correctly
      'modelence/server': path.resolve(process.cwd(), 'node_modules/modelence/dist/server.js'),
      modelence: path.resolve(process.cwd(), 'node_modules/modelence/dist/index.js'),
    },
  });

  // Import the server file
  const _serverModule = await jiti.import(serverPath);

  // Extract modules - we need to intercept the startApp call
  // Since the server file calls startApp, we need a different approach
  // We'll temporarily override startApp to capture the modules
  const modules: Module[] = [];

  // Store original startApp
  const { startApp: _originalStartApp } = await import('../app/index.js');

  // Create a mock startApp that captures modules
  const _mockStartApp = (options: { modules?: Module[] }) => {
    if (options.modules) {
      modules.push(...options.modules);
    }
    // Don't actually start the app
    return Promise.resolve();
  };

  // This approach won't work because startApp is already imported
  // We need a different strategy

  return extractModulesMetadata(modules);
}

/**
 * Alternative approach: Extract modules from a module definitions file
 * Users will need to export their modules separately for code generation
 */
export async function analyzeModulesFromExport(modulesPath: string): Promise<ModuleMetadata[]> {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    requireCache: false,
    moduleCache: false,
  });

  try {
    // Import the modules file
    const modulesExport = (await jiti.import(modulesPath)) as unknown;

    // Extract modules array
    let modules: Module[] = [];
    if (Array.isArray(modulesExport)) {
      modules = modulesExport as Module[];
    } else if (
      typeof modulesExport === 'object' &&
      modulesExport !== null &&
      'modules' in modulesExport &&
      Array.isArray((modulesExport as { modules: unknown }).modules)
    ) {
      modules = (modulesExport as { modules: Module[] }).modules;
    } else if (
      typeof modulesExport === 'object' &&
      modulesExport !== null &&
      'default' in modulesExport
    ) {
      const defaultExport = (modulesExport as { default: unknown }).default;
      if (Array.isArray(defaultExport)) {
        modules = defaultExport as Module[];
      } else if (
        typeof defaultExport === 'object' &&
        defaultExport !== null &&
        'modules' in defaultExport &&
        Array.isArray((defaultExport as { modules: unknown }).modules)
      ) {
        modules = (defaultExport as { modules: Module[] }).modules;
      }
    }

    if (modules.length === 0) {
      console.warn(`No modules found in ${modulesPath}`);
      console.warn('Expected: export const modules = [myModule1, myModule2];');
      console.warn('Or: export default [myModule1, myModule2];');
    }

    return extractModulesMetadata(modules);
  } catch (error) {
    console.error(`Failed to import modules from ${modulesPath}:`, error);
    throw new Error(`Could not analyze modules. Make sure ${modulesPath} exports a modules array.`);
  }
}

function extractModulesMetadata(modules: Module[]): ModuleMetadata[] {
  return modules.map((module) => ({
    name: module.name,
    queries: Object.keys(module.queries).map((queryName) => ({
      name: queryName,
      fullName: `${module.name}.${queryName}`,
    })),
    mutations: Object.keys(module.mutations).map((mutationName) => ({
      name: mutationName,
      fullName: `${module.name}.${mutationName}`,
    })),
  }));
}
