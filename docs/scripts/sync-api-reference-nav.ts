#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface DocsJson {
  navigation: {
    tabs: Array<{
      tab: string;
      groups: Array<{ group: string; pages: unknown[] }>;
    }>;
  };
  [key: string]: unknown;
}

interface NavGroup {
  group: string;
  pages: Array<string | NavGroup>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiReferenceDir = path.join(repoRoot, 'docs/web/api-reference');
const docsConfigPath = path.join(repoRoot, 'docs/web/docs.json');

const KIND_ORDER = ['classes', 'interfaces', 'functions', 'variables', 'type-aliases', 'namespaces'] as const;
const KIND_LABEL: Record<string, string> = {
  classes: 'Classes',
  interfaces: 'Interfaces',
  functions: 'Functions',
  variables: 'Variables',
  'type-aliases': 'Type Aliases',
  namespaces: 'Namespaces',
};

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function walkMdx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMdx(full));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      out.push(full);
    }
  }
  return out;
}

function pageIdFromPath(absPath: string): string {
  const relFromDocsWeb = toPosix(path.relative(path.join(repoRoot, 'docs/web'), absPath));
  return relFromDocsWeb.replace(/\.mdx$/, '');
}

interface PackageEntry {
  pkg: string;
  subpath: string | null;
  kind: string | null;
  pageId: string;
  symbol: string;
}

function classify(pageId: string): PackageEntry | null {
  const parts = pageId.split('/');
  if (parts[0] !== 'api-reference') return null;

  let cursor = 1;
  let pkg: string;
  if (parts[cursor] === '@modelence') {
    pkg = `@modelence/${parts[cursor + 1]}`;
    cursor += 2;
  } else {
    pkg = parts[cursor];
    cursor += 1;
  }

  if (cursor >= parts.length) return null;

  const remaining = parts.slice(cursor);

  // Package overview: api-reference/<pkg>/index
  if (remaining.length === 1 && remaining[0] === 'index') {
    return { pkg, subpath: null, kind: null, pageId, symbol: 'index' };
  }

  // For `modelence` package, the first segment is always the subpath
  // (server/client/index). For scoped packages (@modelence/*) there's no
  // subpath level — kinds sit directly under the package.
  let subpath: string | null = null;
  let kindIndex = 0;
  const isModelencePkg = pkg === 'modelence';
  const firstIsKind = KIND_ORDER.includes(remaining[0] as (typeof KIND_ORDER)[number]);

  if (isModelencePkg && !firstIsKind) {
    subpath = remaining[0];
    kindIndex = 1;
  } else if (!isModelencePkg && !firstIsKind) {
    return null;
  }

  if (kindIndex >= remaining.length) return null;
  const kindOrIndex = remaining[kindIndex];
  if (kindOrIndex === 'index') {
    return { pkg, subpath, kind: null, pageId, symbol: 'index' };
  }
  if (!KIND_ORDER.includes(kindOrIndex as (typeof KIND_ORDER)[number])) {
    return null;
  }
  const symbol = remaining.slice(kindIndex + 1).join('/').replace(/\/index$/, '');
  return { pkg, subpath, kind: kindOrIndex, pageId, symbol };
}

function sortBy<T>(arr: T[], key: (t: T) => string): T[] {
  return [...arr].sort((a, b) => key(a).localeCompare(key(b)));
}

function buildKindGroups(entries: PackageEntry[]): NavGroup[] {
  const byKind = new Map<string, PackageEntry[]>();
  for (const entry of entries) {
    if (!entry.kind) continue;
    if (!byKind.has(entry.kind)) byKind.set(entry.kind, []);
    byKind.get(entry.kind)!.push(entry);
  }
  const groups: NavGroup[] = [];
  for (const kind of KIND_ORDER) {
    const items = byKind.get(kind);
    if (!items || items.length === 0) continue;
    groups.push({
      group: KIND_LABEL[kind],
      pages: sortBy(items, (e) => e.symbol).map((e) => e.pageId),
    });
  }
  return groups;
}

function buildPackageGroup(pkg: string, entries: PackageEntry[]): NavGroup {
  const pages: Array<string | NavGroup> = [];

  const overview = entries.find((e) => e.subpath === null && e.symbol === 'index');
  if (overview) pages.push(overview.pageId);

  if (pkg === 'modelence') {
    const subpaths = ['server', 'client', 'index'];
    for (const sp of subpaths) {
      const subEntries = entries.filter((e) => e.subpath === sp);
      if (subEntries.length === 0) continue;
      const subOverview = subEntries.find((e) => e.kind === null && e.symbol === 'index');
      const subpathPages: Array<string | NavGroup> = [];
      if (subOverview) subpathPages.push(subOverview.pageId);
      subpathPages.push(...buildKindGroups(subEntries));
      const label = sp === 'index' ? 'Shared' : sp === 'server' ? 'Server' : 'Client';
      pages.push({ group: label, pages: subpathPages });
    }
  } else {
    pages.push(...buildKindGroups(entries.filter((e) => e.subpath === null)));
  }

  return { group: pkg, pages };
}

function buildApiReferenceTab(): Array<{ group: string; pages: unknown[] }> {
  const allFiles = walkMdx(apiReferenceDir);
  const entries: PackageEntry[] = [];
  for (const file of allFiles) {
    const pageId = pageIdFromPath(file);
    const entry = classify(pageId);
    if (entry) entries.push(entry);
  }

  const byPkg = new Map<string, PackageEntry[]>();
  for (const entry of entries) {
    if (!byPkg.has(entry.pkg)) byPkg.set(entry.pkg, []);
    byPkg.get(entry.pkg)!.push(entry);
  }

  const pkgOrder = [
    'modelence',
    '@modelence/react-query',
    '@modelence/ai',
    '@modelence/next',
    '@modelence/auth-ui',
    '@modelence/smtp',
    '@modelence/resend',
    '@modelence/aws-ses',
  ];

  const groups: Array<{ group: string; pages: unknown[] }> = [];
  for (const pkg of pkgOrder) {
    const pkgEntries = byPkg.get(pkg);
    if (!pkgEntries || pkgEntries.length === 0) continue;
    groups.push(buildPackageGroup(pkg, pkgEntries));
  }

  const knownPkgs = new Set(pkgOrder);
  for (const [pkg, pkgEntries] of byPkg) {
    if (knownPkgs.has(pkg)) continue;
    groups.push(buildPackageGroup(pkg, pkgEntries));
  }

  return groups;
}

function main() {
  const docsRaw = fs.readFileSync(docsConfigPath, 'utf8');
  const docs: DocsJson = JSON.parse(docsRaw);
  const tabs = docs.navigation.tabs;
  const apiTabIndex = tabs.findIndex((t) => t.tab === 'API Reference');
  if (apiTabIndex === -1) {
    throw new Error('API Reference tab not found in docs.json');
  }

  const newGroups = buildApiReferenceTab();
  tabs[apiTabIndex] = { tab: 'API Reference', groups: newGroups };

  const updated = JSON.stringify(docs, null, 2) + '\n';
  fs.writeFileSync(docsConfigPath, updated);

  let pageCount = 0;
  function count(pages: unknown[]): void {
    for (const p of pages) {
      if (typeof p === 'string') pageCount++;
      else if (p && typeof p === 'object' && 'pages' in p) {
        count((p as { pages: unknown[] }).pages);
      }
    }
  }
  for (const g of newGroups) count(g.pages);

  console.log(`Updated API Reference tab: ${newGroups.length} top-level groups, ${pageCount} pages.`);
}

main();
