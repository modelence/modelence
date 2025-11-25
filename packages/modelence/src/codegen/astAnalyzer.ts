import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ObjectProperty } from '@babel/types';

// Handle default export for traverse (CommonJS/ESM compatibility)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse = (babelTraverse as any).default || babelTraverse;

export interface ModuleMetadata {
  name: string;
  queries: QueryMetadata[];
  mutations: MutationMetadata[];
  filePath: string;
}

export interface QueryMetadata {
  name: string;
  fullName: string;
  argsType?: string; // TypeScript type string for arguments
  returnType?: string; // TypeScript type string for return value
}

export interface MutationMetadata {
  name: string;
  fullName: string;
  argsType?: string;
  returnType?: string;
}

/**
 * Analyzes the server entry file using AST parsing to extract module metadata
 * This approach doesn't require running the code, making it safe for build-time
 */
export async function analyzeModulesFromServerFile(serverPath: string): Promise<ModuleMetadata[]> {
  const serverDir = path.dirname(serverPath);

  // Read the server file
  const serverCode = await fs.readFile(serverPath, 'utf-8');

  // Parse the file into an AST
  const ast = parse(serverCode, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  // Find all module imports and their sources
  const moduleImports = new Map<string, string>(); // localName -> importPath
  const foundModules: ModuleInfo[] = [];

  traverse(ast, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ImportDeclaration(nodePath: any) {
      const importPath = nodePath.node.source.value;
      for (const specifier of nodePath.node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          moduleImports.set(specifier.local.name, importPath);
        } else if (specifier.type === 'ImportSpecifier') {
          moduleImports.set(specifier.local.name, importPath);
        }
      }
    },
  });

  // Find the startApp call and extract modules array
  traverse(ast, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CallExpression(nodePath: any) {
      const callee = nodePath.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'startApp') {
        const args = nodePath.node.arguments;
        if (args.length > 0 && args[0].type === 'ObjectExpression') {
          const modulesProperty = args[0].properties.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (prop: any): prop is ObjectProperty =>
              prop.type === 'ObjectProperty' &&
              prop.key.type === 'Identifier' &&
              prop.key.name === 'modules'
          );

          if (modulesProperty && modulesProperty.value.type === 'ArrayExpression') {
            // Extract module names from the array
            for (const element of modulesProperty.value.elements) {
              if (element?.type === 'Identifier') {
                const moduleName = element.name;
                const importPath = moduleImports.get(moduleName);
                if (importPath) {
                  // Found a module! Now we need to analyze its file
                  foundModules.push({
                    name: moduleName,
                    importPath,
                    serverDir,
                  });
                }
              }
            }
          }
        }
      }
    },
  });

  // Analyze each module file to extract queries and mutations
  const analyzedModules: ModuleMetadata[] = [];
  for (const moduleInfo of foundModules) {
    const analyzed = await analyzeModuleFile(moduleInfo.importPath, moduleInfo.serverDir);
    if (analyzed) {
      analyzedModules.push(analyzed);
    }
  }

  return analyzedModules;
}

interface ModuleInfo {
  name: string;
  importPath: string;
  serverDir: string;
}

/**
 * Analyzes a module file to extract its name, queries, and mutations
 */
async function analyzeModuleFile(
  importPath: string,
  serverDir: string
): Promise<ModuleMetadata | null> {
  try {
    // Resolve the full path
    const fullPath = await resolveModulePath(importPath, serverDir);
    const moduleCode = await fs.readFile(fullPath, 'utf-8');

    // Parse the module file
    const ast = parse(moduleCode, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    let moduleName = '';
    const queries: QueryMetadata[] = [];
    const mutations: MutationMetadata[] = [];

    // Find the Module constructor call (can be in export default or a variable)
    traverse(ast, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      NewExpression(nodePath: any) {
        const callee = nodePath.node.callee;
        if (callee.type === 'Identifier' && callee.name === 'Module') {
          const args = nodePath.node.arguments;

          // First argument is the module name
          if (args.length > 0 && args[0].type === 'StringLiteral') {
            moduleName = args[0].value;
          }

          // Second argument is the config object
          if (args.length > 1 && args[1].type === 'ObjectExpression') {
            const config = args[1];

            // Find queries property
            const queriesProperty = config.properties.find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (prop: any): prop is ObjectProperty =>
                prop.type === 'ObjectProperty' &&
                prop.key.type === 'Identifier' &&
                prop.key.name === 'queries'
            );

            if (queriesProperty && queriesProperty.value.type === 'ObjectExpression') {
              for (const prop of queriesProperty.value.properties) {
                // Handle both ObjectProperty and ObjectMethod (async methods)
                if (
                  (prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') &&
                  (prop.key.type === 'Identifier' || prop.key.type === 'StringLiteral')
                ) {
                  const queryName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;

                  // Extract type information from the method
                  const typeInfo = extractMethodTypes(prop, moduleCode);

                  queries.push({
                    name: queryName,
                    fullName: `${moduleName}.${queryName}`,
                    argsType: typeInfo.argsType,
                    returnType: typeInfo.returnType,
                  });
                }
              }
            }

            // Find mutations property
            const mutationsProperty = config.properties.find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (prop: any): prop is ObjectProperty =>
                prop.type === 'ObjectProperty' &&
                prop.key.type === 'Identifier' &&
                prop.key.name === 'mutations'
            );

            if (mutationsProperty && mutationsProperty.value.type === 'ObjectExpression') {
              for (const prop of mutationsProperty.value.properties) {
                // Handle both ObjectProperty and ObjectMethod (async methods)
                if (
                  (prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') &&
                  (prop.key.type === 'Identifier' || prop.key.type === 'StringLiteral')
                ) {
                  const mutationName =
                    prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;

                  // Extract type information from the method
                  const typeInfo = extractMethodTypes(prop, moduleCode);

                  mutations.push({
                    name: mutationName,
                    fullName: `${moduleName}.${mutationName}`,
                    argsType: typeInfo.argsType,
                    returnType: typeInfo.returnType,
                  });
                }
              }
            }
          }
        }
      },
    });

    if (moduleName) {
      return {
        name: moduleName,
        queries,
        mutations,
        filePath: fullPath,
      };
    }

    return null;
  } catch (error) {
    console.error(`Failed to analyze module file ${importPath}:`, error);
    return null;
  }
}

/**
 * Extracts type information from a method (ObjectProperty or ObjectMethod)
 * Analyzes Zod schemas and return statements to infer types
 */
function extractMethodTypes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prop: any,
  sourceCode: string
): { argsType?: string; returnType?: string } {
  let argsType: string | undefined;
  let returnType: string | undefined;

  // Get the function body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let functionBody: any;
  if (prop.type === 'ObjectMethod') {
    functionBody = prop.body;
  } else if (prop.type === 'ObjectProperty') {
    const value = prop.value;
    if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
      functionBody = value.body;
    }
  }

  if (!functionBody) {
    return { argsType, returnType };
  }

  // Extract the source code for this method
  const start = functionBody.start;
  const end = functionBody.end;
  if (start !== undefined && end !== undefined) {
    const methodSource = sourceCode.substring(start, end);

    // Look for Zod schema parsing patterns
    // Pattern: z.object({ field: z.string(), ... }).parse(args)
    const zodObjectPattern =
      /z\.object\(\s*\{([^}]+)\}\s*\)\.parse\(|\.object\(\s*\{([^}]+)\}\s*\)\.parse\(/g;
    const zodMatch = zodObjectPattern.exec(methodSource);

    if (zodMatch) {
      const schemaContent = zodMatch[1] || zodMatch[2];
      argsType = convertZodSchemaToTypeScript(schemaContent);
    }

    // Look for explicit return statements to infer return type
    // This is basic - in reality, we'd need full type inference
    if (methodSource.includes('return {')) {
      returnType = 'Record<string, unknown>'; // Generic object type
    } else if (methodSource.includes('return [')) {
      returnType = 'unknown[]'; // Array type
    }
  }

  return { argsType, returnType };
}

/**
 * Converts a Zod schema string to TypeScript type
 * This is a simplified version - handles common cases
 */
function convertZodSchemaToTypeScript(schemaStr: string): string {
  const fields: string[] = [];

  // Parse field definitions like: fieldName: z.string().min(1)
  const fieldPattern = /(\w+):\s*z\.(\w+)\([^)]*\)([^,}\n]*)/g;
  let match;

  while ((match = fieldPattern.exec(schemaStr)) !== null) {
    const fieldName = match[1];
    const zodType = match[2];
    const modifiers = match[3] || '';

    // Map Zod types to TypeScript types
    let tsType = 'unknown';
    switch (zodType) {
      case 'string':
        tsType = 'string';
        break;
      case 'number':
        tsType = 'number';
        break;
      case 'boolean':
        tsType = 'boolean';
        break;
      case 'date':
        tsType = 'Date';
        break;
      case 'array':
        tsType = 'unknown[]';
        break;
      case 'object':
        tsType = 'Record<string, unknown>';
        break;
    }

    // Check if optional
    const isOptional = modifiers.includes('.optional()');
    const fieldDef = isOptional ? `${fieldName}?: ${tsType}` : `${fieldName}: ${tsType}`;
    fields.push(fieldDef);
  }

  if (fields.length > 0) {
    return `{ ${fields.join('; ')} }`;
  }

  return 'Record<string, unknown>';
}

/**
 * Resolves a module import path to an absolute file path
 */
async function resolveModulePath(importPath: string, serverDir: string): Promise<string> {
  // Handle relative imports
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const resolved = path.resolve(serverDir, importPath);

    // Try common extensions and index files
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      try {
        const stats = await fs.stat(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    throw new Error(`Could not resolve module path: ${importPath} (tried ${resolved})`);
  }

  // Handle package imports (node_modules)
  // For now, we'll skip these as modules should be local
  throw new Error(`Cannot resolve package import: ${importPath}`);
}
