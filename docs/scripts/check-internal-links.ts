#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface BrokenLink {
  file: string;
  line: number | null;
  link: string;
  route: string;
}

interface DocsJsonLink {
  trail: string;
  link: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docsRoot = path.join(repoRoot, 'docs/web');
const docsConfigPath = path.join(docsRoot, 'docs.json');
const origin = 'https://docs.local';

const contentExtensions = new Set<string>(['.md', '.mdx']);
const ignoredDirs = new Set<string>(['node_modules']);

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeRoute(route: string): string {
  let normalized = decodeURI(route);
  normalized = normalized.replace(/\/+/g, '/');

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1) {
    normalized = normalized.replace(/\/$/, '');
  }

  return normalized;
}

function routeForContentFile(filePath: string): string {
  const relativePath = toPosix(path.relative(docsRoot, filePath));
  const withoutExtension = relativePath.replace(/\.(md|mdx)$/u, '');
  const route = normalizeRoute(`/${withoutExtension}`);

  if (route === '/index') {
    return '/';
  }

  if (route.endsWith('/index')) {
    return route.slice(0, -'/index'.length) || '/';
  }

  return route;
}

function buildValidRoutes(files: string[]): Set<string> {
  const routes = new Set<string>(['/']);

  for (const filePath of files) {
    const relativePath = toPosix(path.relative(docsRoot, filePath));
    const extension = path.extname(filePath);

    if (contentExtensions.has(extension)) {
      const withoutExtension = relativePath.replace(/\.(md|mdx)$/u, '');
      const route = normalizeRoute(`/${withoutExtension}`);
      routes.add(route);
      routes.add(routeForContentFile(filePath));
    } else {
      routes.add(normalizeRoute(`/${relativePath}`));
    }
  }

  return routes;
}

function isExternalLink(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('//');
}

function stripUrlSuffix(value: string): string {
  return value.split('#')[0].split('?')[0];
}

function resolveInternalLink(rawValue: string, sourceRoute: string): string | null {
  const value = rawValue.trim();

  if (
    value === '' ||
    value.startsWith('#') ||
    value.startsWith('{') ||
    value.startsWith('$') ||
    isExternalLink(value)
  ) {
    return null;
  }

  const withoutSuffix = stripUrlSuffix(value);
  if (withoutSuffix === '') {
    return null;
  }

  const baseUrl = `${origin}${sourceRoute === '/' ? '/' : sourceRoute}`;
  const resolved = new URL(withoutSuffix, baseUrl);

  if (resolved.origin !== origin) {
    return null;
  }

  return normalizeRoute(resolved.pathname);
}

function extractMarkdownLinks(line: string): string[] {
  const links: string[] = [];
  const markdownLinkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

  for (const match of line.matchAll(markdownLinkPattern)) {
    if (match[0].startsWith('!')) {
      continue;
    }

    const link = match[1];
    if (link) {
      links.push(link);
    }
  }

  return links;
}

function extractHrefLinks(line: string): string[] {
  const links: string[] = [];
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/gu;

  for (const match of line.matchAll(hrefPattern)) {
    const link = match[1] ?? match[2] ?? match[3];
    if (link) {
      links.push(link);
    }
  }

  return links;
}

function checkContentFile(filePath: string, validRoutes: Set<string>): BrokenLink[] {
  const sourceRoute = routeForContentFile(filePath);
  const relativePath = toPosix(path.relative(repoRoot, filePath));
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  const failures: BrokenLink[] = [];
  let inCodeFence = false;

  lines.forEach((line, index) => {
    if (/^\s*```/u.test(line)) {
      inCodeFence = !inCodeFence;
      return;
    }

    if (inCodeFence) {
      return;
    }

    const links = [...extractMarkdownLinks(line), ...extractHrefLinks(line)];

    for (const link of links) {
      const route = resolveInternalLink(link, sourceRoute);

      if (route && !validRoutes.has(route)) {
        failures.push({
          file: relativePath,
          line: index + 1,
          link,
          route,
        });
      }
    }
  });

  return failures;
}

function collectDocsJsonLinks(value: unknown, trail = 'docs.json'): DocsJsonLink[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDocsJsonLinks(item, `${trail}[${index}]`));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const links: DocsJsonLink[] = [];

  for (const [key, child] of Object.entries(value)) {
    const childTrail = `${trail}.${key}`;

    if (
      typeof child === 'string' &&
      (key === 'href' || key === 'destination' || key === 'favicon' || key === 'light' || key === 'dark')
    ) {
      links.push({ trail: childTrail, link: child });
    }

    if (key === 'pages' && Array.isArray(child)) {
      child.forEach((page, index) => {
        if (typeof page === 'string') {
          links.push({ trail: `${childTrail}[${index}]`, link: `/${page}` });
        } else {
          links.push(...collectDocsJsonLinks(page, `${childTrail}[${index}]`));
        }
      });
      continue;
    }

    links.push(...collectDocsJsonLinks(child, childTrail));
  }

  return links;
}

function checkDocsJson(validRoutes: Set<string>): BrokenLink[] {
  const config = JSON.parse(fs.readFileSync(docsConfigPath, 'utf8')) as unknown;
  const links = collectDocsJsonLinks(config);
  const failures: BrokenLink[] = [];

  for (const { trail, link } of links) {
    const route = resolveInternalLink(link, '/');

    if (route && !validRoutes.has(route)) {
      failures.push({
        file: trail,
        line: null,
        link,
        route,
      });
    }
  }

  return failures;
}

const files = walk(docsRoot);
const validRoutes = buildValidRoutes(files);
const contentFiles = files.filter(filePath => contentExtensions.has(path.extname(filePath)));
const failures = [
  ...contentFiles.flatMap(filePath => checkContentFile(filePath, validRoutes)),
  ...checkDocsJson(validRoutes),
];

if (failures.length > 0) {
  console.error('Found broken internal documentation links:\n');

  for (const failure of failures) {
    const location = failure.line ? `${failure.file}:${failure.line}` : failure.file;
    console.error(`- ${location} links to ${failure.link} (resolved ${failure.route})`);
  }

  process.exit(1);
}

console.log(`Checked ${contentFiles.length} content files. No broken internal documentation links found.`);
