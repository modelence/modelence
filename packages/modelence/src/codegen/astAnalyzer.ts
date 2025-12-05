import * as ts from 'typescript';
import { promises as fs } from 'fs';
import * as path from 'path';

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

  // Parse the file into an AST using TypeScript compiler
  const sourceFile = ts.createSourceFile(serverPath, serverCode, ts.ScriptTarget.Latest, true);

  // Find all module imports and their sources
  const moduleImports = new Map<string, string>(); // localName -> importPath
  const foundModules: ModuleInfo[] = [];

  // Visit all nodes to find imports
  function visitNode(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const importPath = (node.moduleSpecifier as ts.StringLiteral).text;

      if (node.importClause) {
        // Handle default import: import Foo from './foo'
        if (node.importClause.name) {
          moduleImports.set(node.importClause.name.text, importPath);
        }

        // Handle named imports: import { Foo } from './foo'
        if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) {
            moduleImports.set(element.name.text, importPath);
          }
        }
      }
    }

    // Find the startApp call
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'startApp') {
        // Get the first argument (config object)
        const configArg = node.arguments[0];
        if (configArg && ts.isObjectLiteralExpression(configArg)) {
          // Find the modules property
          const modulesProperty = configArg.properties.find(
            (prop): prop is ts.PropertyAssignment =>
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'modules'
          );

          if (modulesProperty && ts.isArrayLiteralExpression(modulesProperty.initializer)) {
            // Extract module identifiers from the array
            for (const element of modulesProperty.initializer.elements) {
              if (ts.isIdentifier(element)) {
                const moduleName = element.text;
                const importPath = moduleImports.get(moduleName);
                if (importPath) {
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
    }

    ts.forEachChild(node, visitNode);
  }

  visitNode(sourceFile);

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
    const sourceFile = ts.createSourceFile(fullPath, moduleCode, ts.ScriptTarget.Latest, true);

    // Create TypeScript program and type checker for type inference
    const program = ts.createProgram([fullPath], {
      noEmit: true,
      target: ts.ScriptTarget.Latest,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
      checkJs: false,
    });
    const typeChecker = program.getTypeChecker();

    let moduleName = '';
    const queries: QueryMetadata[] = [];
    const mutations: MutationMetadata[] = [];

    // Find the Module constructor call
    function visitNode(node: ts.Node) {
      if (ts.isNewExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'Module') {
          const args = node.arguments;

          // First argument is the module name
          if (args && args.length > 0 && ts.isStringLiteral(args[0])) {
            moduleName = args[0].text;
          }

          // Second argument is the config object
          if (args && args.length > 1 && ts.isObjectLiteralExpression(args[1])) {
            const config = args[1];

            // Find queries property
            const queriesProperty = config.properties.find(
              (prop): prop is ts.PropertyAssignment =>
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === 'queries'
            );

            if (queriesProperty && ts.isObjectLiteralExpression(queriesProperty.initializer)) {
              for (const prop of queriesProperty.initializer.properties) {
                if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
                  const queryName = ts.isIdentifier(prop.name)
                    ? prop.name.text
                    : ts.isStringLiteral(prop.name)
                      ? prop.name.text
                      : '';

                  if (queryName) {
                    // Extract type information
                    const typeInfo = extractMethodTypes(prop, moduleCode, sourceFile, typeChecker);

                    queries.push({
                      name: queryName,
                      fullName: `${moduleName}.${queryName}`,
                      argsType: typeInfo.argsType,
                      returnType: typeInfo.returnType,
                    });
                  }
                }
              }
            }

            // Find mutations property
            const mutationsProperty = config.properties.find(
              (prop): prop is ts.PropertyAssignment =>
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === 'mutations'
            );

            if (mutationsProperty && ts.isObjectLiteralExpression(mutationsProperty.initializer)) {
              for (const prop of mutationsProperty.initializer.properties) {
                if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
                  const mutationName = ts.isIdentifier(prop.name)
                    ? prop.name.text
                    : ts.isStringLiteral(prop.name)
                      ? prop.name.text
                      : '';

                  if (mutationName) {
                    // Extract type information
                    const typeInfo = extractMethodTypes(prop, moduleCode, sourceFile, typeChecker);

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
        }
      }

      ts.forEachChild(node, visitNode);
    }

    visitNode(sourceFile);

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
 * Extracts type information from a method (PropertyAssignment or MethodDeclaration)
 * Analyzes Zod schemas and return statements to infer types
 */
function extractMethodTypes(
  prop: ts.PropertyAssignment | ts.MethodDeclaration,
  sourceCode: string,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker
): { argsType?: string; returnType?: string } {
  let argsType: string | undefined;
  let returnType: string | undefined;

  // Get the function body
  let functionBody: ts.Node | undefined;
  let functionNode: ts.FunctionLikeDeclaration | undefined;

  if (ts.isMethodDeclaration(prop)) {
    functionBody = prop.body;
    functionNode = prop;
  } else if (ts.isPropertyAssignment(prop)) {
    const initializer = prop.initializer;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      functionBody = initializer.body;
      functionNode = initializer;
    }
  }

  if (!functionBody) {
    return { argsType, returnType };
  }

  // Extract the source code for this method
  const start = functionBody.getStart(sourceFile);
  const end = functionBody.getEnd();
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

  // Try to use TypeScript's type checker for return type inference
  if (functionNode) {
    const signature = typeChecker.getSignatureFromDeclaration(functionNode);
    if (signature) {
      const returnTypeNode = signature.getReturnType();
      if (returnTypeNode) {
        // Get the type string, removing Promise wrapper if present
        let typeString = typeChecker.typeToString(returnTypeNode);

        // Remove Promise wrapper: Promise<Type> -> Type
        const promiseMatch = typeString.match(/^Promise<(.+)>$/);
        if (promiseMatch) {
          typeString = promiseMatch[1];
        }

        // Only use the inferred type if it's not 'any' or 'void'
        if (typeString !== 'any' && typeString !== 'void') {
          returnType = typeString;
        }
      }
    }
  }

  // Fallback to basic pattern matching if type checker didn't work
  if (!returnType) {
    if (methodSource.includes('return {')) {
      returnType = 'Record<string, unknown>';
    } else if (methodSource.includes('return [')) {
      returnType = 'unknown[]';
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
