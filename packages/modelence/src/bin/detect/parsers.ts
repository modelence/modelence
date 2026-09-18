import ts from 'typescript';
import { posix } from 'path';

/*
  Pure parsers for the files detection reads. No I/O, no decisions: each
  turns one file's text or JSON into a fact the detectors can use.
*/

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

const MINIMUM_NODE_MAJOR = 18;

// The first version number in a semver range, e.g. ">=20.10 <23" → "20",
// "22.x" → "22". Anything below the supported floor is ignored.
export function parseNodeMajor(range: unknown): string | undefined {
  if (typeof range !== 'string') {
    return undefined;
  }
  const match = range.match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  return major >= MINIMUM_NODE_MAJOR ? String(major) : undefined;
}

export function parseProcfileWebCommand(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*web\s*:\s*(.+?)\s*$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/*
  `npm ci` refuses a package-lock.json that disagrees with package.json — a
  common state for generated projects (Lovable adds a dependency without
  refreshing the lock). Compares the root package's declared dependencies
  with the lock's root entry (lockfileVersion 2+). An old v1 lock has no root
  entry, so it is trusted as-is.
*/
export function isLockfileInSync(
  packageJson: Record<string, unknown>,
  lockfile: Record<string, unknown>
): boolean {
  const packages = lockfile.packages as Record<string, Record<string, unknown>> | undefined;
  const root = packages?.[''];
  if (!root) {
    return true;
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const declared = (packageJson[field] ?? {}) as Record<string, string>;
    const locked = (root[field] ?? {}) as Record<string, string>;
    const names = new Set([...Object.keys(declared), ...Object.keys(locked)]);
    for (const name of names) {
      if (declared[name] !== locked[name]) {
        return false;
      }
    }
  }
  return true;
}

// package.json `packageManager` ("pnpm@10.4.1+sha512...") → "10.4.1" when it
// names the given manager. Anything that is not a plain semver version is
// ignored rather than passed to npm.
export function parsePackageManagerVersion(
  field: unknown,
  manager: PackageManager
): string | undefined {
  if (typeof field !== 'string') {
    return undefined;
  }
  const match = /^([a-z]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.*)?$/.exec(field.trim());
  if (!match || match[1] !== manager) {
    return undefined;
  }
  return match[2];
}

// pnpm-lock.yaml `lockfileVersion` → the pnpm major that reads it. 9.0 is
// written by pnpm 9 and 10 alike; 10 is picked because it reads both and
// only warns about unapproved build scripts where 11 fails.
const PNPM_MAJOR_BY_LOCKFILE: Record<string, number> = {
  '5': 7,
  '6': 8,
  '9': 10,
};

export function pnpmMajorFromLockfile(lockfileText: string): number | undefined {
  const match = /^lockfileVersion:\s*['"]?(\d+)(?:\.\d+)?['"]?\s*$/m.exec(lockfileText);
  if (!match) {
    return undefined;
  }
  return PNPM_MAJOR_BY_LOCKFILE[match[1]];
}

// The `packages:` list of pnpm-workspace.yaml. Only the flat "- glob" form
// pnpm documents is handled; anything else yields no globs.
export function parsePnpmWorkspaceGlobs(yamlText: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yamlText.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
    if (item) {
      globs.push(item[1].trim());
    } else if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
      inPackages = false;
    }
  }
  return globs;
}

// package.json `workspaces`: an array, or yarn's `{ packages: [...] }`.
export function parsePackageJsonWorkspaces(packageJson: Record<string, unknown>): string[] {
  const field = packageJson.workspaces;
  if (Array.isArray(field)) {
    return field.filter((entry): entry is string => typeof entry === 'string');
  }
  if (field && typeof field === 'object') {
    const packages = (field as { packages?: unknown }).packages;
    return Array.isArray(packages)
      ? packages.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
  return [];
}

export interface ViteOutput {
  outDir?: string;
  ambiguous: boolean;
}

// Read syntax only: importing a Vite config would execute arbitrary project code.
// Unknown expressions are reported, never treated as the default output path.
export function parseViteOutput(configText: string): ViteOutput {
  const values: (string | undefined)[] = [];
  function literal(node: ts.Node): string | undefined {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : undefined;
  }
  function output(node: ts.Expression): string | undefined {
    const direct = literal(node);
    if (direct !== undefined) return direct;
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
      return undefined;
    const call = node.expression;
    if (call.expression.getText() !== 'path' || !['resolve', 'join'].includes(call.name.text))
      return undefined;
    const [base, ...rest] = node.arguments;
    if (
      !base ||
      !['__dirname', 'import.meta.dirname'].includes(base.getText()) ||
      rest.length === 0
    )
      return undefined;
    const parts = rest.map(literal);
    if (parts.some((part) => part === undefined)) return undefined;
    const segments = parts as string[];
    // Absolute segments would refer to the build machine, not the archive.
    if (segments.some((part) => posix.isAbsolute(part))) return undefined;
    return posix.join(...segments);
  }
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'outDir'
    ) {
      values.push(output(node.initializer));
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'outDir') {
      values.push(undefined);
    }
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile('vite.config.ts', configText, ts.ScriptTarget.Latest, true));
  // Also accept an object fragment for parser callers and diagnostics.
  if (values.length === 0) {
    visit(ts.createSourceFile('fragment.ts', `({${configText}})`, ts.ScriptTarget.Latest, true));
  }
  if (values.length === 0) return { ambiguous: false };
  const normalized = values.map((value) =>
    value ? posix.normalize(value).replace(/\/+$/, '') : undefined
  );
  if (
    normalized.some((value) => value === undefined || posix.isAbsolute(value)) ||
    new Set(normalized).size !== 1
  ) {
    return { ambiguous: true };
  }
  return { outDir: normalized[0], ambiguous: false };
}

export function parseViteOutDir(configText: string): string | undefined {
  return parseViteOutput(configText).outDir;
}

// `modules = ["nodejs-24", "postgresql-16"]` from a .replit file.
export function parseReplitModules(replitText: string): string[] {
  const match = /^modules\s*=\s*\[([^\]]*)\]/m.exec(replitText);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const segments = normalized.split('/');
  const pattern = segments
    .map((segment, index) => {
      const last = index === segments.length - 1;
      if (segment === '**') return last ? '.*' : '(?:[^/]+/)*';
      const value = segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      return value + (last ? '' : '/');
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}
