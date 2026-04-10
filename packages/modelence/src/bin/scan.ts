import fs from 'fs';
import path from 'path';

const MODULE_FOLDERS = ['stores', 'queries', 'mutations', 'crons', 'routes'] as const;
const MODULE_INDEX = 'index';
const TS_EXTENSIONS = ['.ts', '.js', '.mts', '.mjs'];

const VALID_MODULE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type ModuleFolderName = (typeof MODULE_FOLDERS)[number];

interface ScannedFile {
  name: string;
  filePath: string;
}

interface ScannedModule {
  name: string;
  identifier: string;
  folders: Partial<Record<ModuleFolderName, ScannedFile[]>>;
  indexPath: string | null;
}

interface ScannedMigration {
  filePath: string;
  identifier: string;
}

/**
 * Scans the modules directory for auto-loadable module definitions.
 * Each subdirectory becomes a module. Each sub-folder (stores, queries, etc.)
 * contains one default export per file.
 */
export function scanModulesDir(modulesDir: string): ScannedModule[] {
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  const modules: ScannedModule[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirName = entry.name;
    const identifier = toIdentifier(dirName);

    if (!VALID_MODULE_NAME.test(identifier)) {
      throw new Error(
        `Invalid module directory name: "${dirName}". ` +
          'Module names must be valid JS identifiers (letters, digits, underscores; cannot start with a digit). ' +
          'Hyphens are allowed and converted to underscores for internal use.'
      );
    }

    const moduleDirPath = path.join(modulesDir, dirName);
    const scanned: ScannedModule = {
      name: dirName,
      identifier,
      folders: {},
      indexPath: null,
    };

    for (const folderName of MODULE_FOLDERS) {
      const folderPath = path.join(moduleDirPath, folderName);
      if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
        const files = scanFolder(folderPath);
        if (files.length > 0) {
          scanned.folders[folderName] = files;
        }
      }
    }

    scanned.indexPath = findFile(moduleDirPath, MODULE_INDEX);

    const hasAnyContent = Object.keys(scanned.folders).length > 0 || scanned.indexPath !== null;
    if (hasAnyContent) {
      modules.push(scanned);
    }
  }

  const seenIdentifiers = new Map<string, string>();
  for (const mod of modules) {
    const prev = seenIdentifiers.get(mod.identifier);
    if (prev) {
      throw new Error(
        `Module identifier collision: directories "${prev}" and "${mod.name}" both resolve to identifier "${mod.identifier}". ` +
          'Rename one of the directories to avoid the conflict.'
      );
    }
    seenIdentifiers.set(mod.identifier, mod.name);
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scans a folder for .ts/.js files, returns sorted entries. Deduplicates by base name (.ts takes priority). */
function scanFolder(dirPath: string): ScannedFile[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const seen = new Map<string, string>();
  const seenIdentifiers = new Map<string, string>();

  for (const ext of TS_EXTENSIONS) {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        continue;
      }

      if (path.extname(entry.name) !== ext) {
        continue;
      }

      const baseName = path.basename(entry.name, ext);
      if (baseName === 'index' || seen.has(baseName)) {
        continue;
      }

      const identifier = toIdentifier(baseName);
      if (!VALID_MODULE_NAME.test(identifier)) {
        throw new Error(
          `Invalid file name: "${entry.name}" in ${dirPath}. ` +
            'File names must be valid JS identifiers (letters, digits, underscores; cannot start with a digit). ' +
            'Hyphens are allowed and converted to underscores for internal use.'
        );
      }

      if (seenIdentifiers.has(identifier)) {
        const prevName = seenIdentifiers.get(identifier)!;
        if (prevName !== baseName) {
          throw new Error(
            `File identifier collision in ${dirPath}: "${prevName}" and "${baseName}" both resolve to identifier "${identifier}". ` +
              'Rename one of the files to avoid the conflict.'
          );
        }
        continue;
      }
      seenIdentifiers.set(identifier, baseName);

      seen.set(baseName, path.join(dirPath, entry.name));
    }
  }

  const result: ScannedFile[] = [];
  for (const [name, filePath] of seen) {
    result.push({ name, filePath });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function findFile(dirPath: string, baseName: string): string | null {
  for (const ext of TS_EXTENSIONS) {
    const filePath = path.join(dirPath, baseName + ext);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function toIdentifier(name: string): string {
  return name.replace(/-/g, '_');
}

/**
 * Scans the migrations directory for auto-loadable migration files.
 * Files are sorted alphabetically so numeric prefixes (e.g. 0001-) control order.
 */
export function scanMigrationsDir(migrationsDir: string): ScannedMigration[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const seenBaseNames = new Map<string, string>();
  const seenIdentifiers = new Map<string, string>();
  const migrations: ScannedMigration[] = [];

  for (const ext of TS_EXTENSIONS) {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        continue;
      }

      if (path.extname(entry.name) !== ext) {
        continue;
      }

      const baseName = path.basename(entry.name, ext);
      if (seenBaseNames.has(baseName)) {
        continue;
      }
      seenBaseNames.set(baseName, entry.name);

      const identifier = `migration_${baseName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

      const prevFile = seenIdentifiers.get(identifier);
      if (prevFile) {
        throw new Error(
          `Migration identifier collision: "${prevFile}" and "${entry.name}" both resolve to identifier "${identifier}". ` +
            'Rename one of the files to avoid the conflict.'
        );
      }
      seenIdentifiers.set(identifier, entry.name);

      migrations.push({
        filePath: path.join(migrationsDir, entry.name),
        identifier,
      });
    }
  }

  return migrations.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

// --- Code generation ---

/** Folders where values are collected into an array (stores, routes). */
const ARRAY_FOLDERS: ReadonlySet<string> = new Set(['stores', 'routes']);

/** Module constructor property name for each folder. */
const FOLDER_TO_PROP: Record<ModuleFolderName, string> = {
  stores: 'stores',
  queries: 'queries',
  mutations: 'mutations',
  crons: 'cronJobs',
  routes: 'routes',
};

/**
 * Generates the content for the auto-modules registration file.
 */
export function generateAutoModulesContent(
  modules: ScannedModule[],
  migrations: ScannedMigration[]
): string {
  const frameworkImports: string[] = ['setAutoLoadedModules'];
  if (modules.length > 0) {
    frameworkImports.push('Module');
  }
  if (migrations.length > 0) {
    frameworkImports.push('setAutoLoadedMigrations');
  }

  const lines: string[] = [
    '// Auto-generated by Modelence. Do not edit.',
    `import { ${frameworkImports.join(', ')} } from 'modelence/server';`,
    '',
  ];

  // Generate module imports
  for (const mod of modules) {
    generateModuleImports(lines, mod);
  }

  // Generate migration imports
  for (const migration of migrations) {
    const importPath = toRelativeImport(migration.filePath);
    lines.push(`import ${migration.identifier} from '${importPath}';`);
  }

  // Generate setAutoLoadedModules call
  lines.push('');
  lines.push('setAutoLoadedModules([');

  for (const mod of modules) {
    generateModuleConstructor(lines, mod);
  }

  lines.push(']);');

  // Generate setAutoLoadedMigrations call
  if (migrations.length > 0) {
    lines.push('');
    lines.push('setAutoLoadedMigrations([');
    for (const migration of migrations) {
      lines.push(`  ${migration.identifier},`);
    }
    lines.push(']);');
  }

  lines.push('');

  return lines.join('\n');
}

function generateModuleImports(lines: string[], mod: ScannedModule): void {
  const id = mod.identifier;

  for (const [folderName, files] of Object.entries(mod.folders) as [
    ModuleFolderName,
    ScannedFile[],
  ][]) {
    for (const entry of files) {
      const entryId = toIdentifier(entry.name);
      const importPath = toRelativeImport(entry.filePath);
      lines.push(`import ${id}_${folderName}_${entryId} from '${importPath}';`);
    }
  }

  if (mod.indexPath) {
    const importPath = toRelativeImport(mod.indexPath);
    lines.push(`import * as ${id}_config from '${importPath}';`);
  }
}

function generateModuleConstructor(lines: string[], mod: ScannedModule): void {
  const id = mod.identifier;
  const props: string[] = [];

  for (const [folderName, files] of Object.entries(mod.folders) as [
    ModuleFolderName,
    ScannedFile[],
  ][]) {
    const propName = FOLDER_TO_PROP[folderName];
    const isArray = ARRAY_FOLDERS.has(folderName);
    const refs = files.map((e) => `${id}_${folderName}_${toIdentifier(e.name)}`);

    if (isArray) {
      props.push(`    ${propName}: [${refs.join(', ')}] as any[],`);
    } else {
      const pairs = files.map(
        (e) => `${JSON.stringify(e.name)}: ${id}_${folderName}_${toIdentifier(e.name)}`
      );
      props.push(`    ${propName}: { ${pairs.join(', ')} },`);
    }
  }

  if (mod.indexPath) {
    props.push(`    configSchema: ${id}_config.configSchema ?? {},`);
    props.push(`    rateLimits: ${id}_config.rateLimits ?? [],`);
    props.push(`    channels: ${id}_config.channels ?? [],`);
  }

  lines.push(`  new Module(${JSON.stringify(mod.name)}, {`);
  lines.push(...props);
  lines.push('  }),');
}

/**
 * Generates the wrapper entry file content.
 */
export function generateEntryContent(serverDir: string, serverEntry: string): string {
  const userEntryPath = path.join(serverDir, serverEntry);
  const relativeEntry = toRelativeImport(userEntryPath);

  return [
    '// Auto-generated by Modelence. Do not edit.',
    `import './autoModules';`,
    `import '${relativeEntry}';`,
    '',
  ].join('\n');
}

/**
 * Converts a file path to a relative import path from .modelence/generated/.
 */
function toRelativeImport(filePath: string): string {
  const generatedDir = path.resolve('.modelence/generated');
  const absolutePath = path.resolve(filePath);
  let rel = path.relative(generatedDir, absolutePath);
  rel = rel.replace(/\\/g, '/');
  rel = rel.replace(/\.(ts|js|mts|mjs)$/, '');
  if (!rel.startsWith('.')) {
    rel = './' + rel;
  }
  return rel;
}

/**
 * Main function: scans for modules and writes the generated files.
 */
export async function generateAutoLoadFiles(serverDir: string, serverEntry: string): Promise<void> {
  const modulesDir = path.join(serverDir, 'modules');
  const migrationsDir = path.join(serverDir, 'migrations');
  const modules = scanModulesDir(modulesDir);
  const migrations = scanMigrationsDir(migrationsDir);

  const generatedDir = path.resolve('.modelence/generated');
  fs.mkdirSync(generatedDir, { recursive: true });

  const autoModulesContent = generateAutoModulesContent(modules, migrations);
  fs.writeFileSync(path.join(generatedDir, 'autoModules.ts'), autoModulesContent);

  const entryContent = generateEntryContent(serverDir, serverEntry);
  fs.writeFileSync(path.join(generatedDir, 'entry.ts'), entryContent);

  if (modules.length > 0) {
    console.log(
      `Auto-loaded ${modules.length} module(s): ${modules.map((m) => m.name).join(', ')}`
    );
  }
  if (migrations.length > 0) {
    console.log(`Auto-loaded ${migrations.length} migration(s)`);
  }
}
