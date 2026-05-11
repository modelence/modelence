import path from 'path';
import fs from 'fs';
import type { ViteDevServer, ModuleNode } from 'vite';

const CSS_EXTENSION_REGEX = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)(\?|$)/;

export type CssAssetSource = 'dev' | 'prod';

export interface CssAssets {
  /**
   * Public URLs suitable for emitting as <link rel="stylesheet">. In dev these
   * point at Vite's transform endpoint; in prod they point at the built asset.
   */
  hrefs: string[];
  source: CssAssetSource;
}

const EMPTY_ASSETS: CssAssets = Object.freeze({ hrefs: [], source: 'dev' }) as CssAssets;

/**
 * Walk the Vite dev module graph from the SSR entry, collecting every CSS
 * module pulled in by the rendered tree. Returns URLs that the browser can
 * request directly so the dev HTML can ship <link rel="stylesheet"> tags
 * before the client JS runs (kills FOUC in dev).
 */
export function collectDevCssAssets(
  viteServer: ViteDevServer,
  entryVirtualPath: string
): CssAssets {
  const ssrModule = viteServer.moduleGraph.getModuleById(
    resolveEntryId(viteServer, entryVirtualPath)
  );
  if (!ssrModule) {
    return EMPTY_ASSETS;
  }

  const seen = new Set<ModuleNode>();
  const hrefs: string[] = [];
  const hrefSet = new Set<string>();

  const walk = (mod: ModuleNode) => {
    if (seen.has(mod)) {
      return;
    }
    seen.add(mod);

    if (mod.url && CSS_EXTENSION_REGEX.test(mod.url) && !hrefSet.has(mod.url)) {
      hrefSet.add(mod.url);
      hrefs.push(mod.url);
    }

    for (const imported of mod.importedModules) {
      walk(imported);
    }
    for (const imported of mod.ssrImportedModules) {
      walk(imported);
    }
  };

  walk(ssrModule);

  return { hrefs, source: 'dev' };
}

function resolveEntryId(viteServer: ViteDevServer, entryVirtualPath: string): string {
  const root = viteServer.config.root;
  // `entryVirtualPath` is rooted at Vite's `root` (e.g. '/index.tsx' under
  // 'src/client'). The module graph keys modules by absolute file id.
  const absolutePath = path.join(root, entryVirtualPath).replace(/\\/g, '/');
  return absolutePath;
}

type SsrManifest = Record<string, string[]>;

/**
 * Read the production SSR manifest produced by `vite build --ssr`. The manifest
 * maps every JS module id to the CSS/asset URLs the client must load to render
 * its output. We flatten the unique CSS entries — the SSR render only touched a
 * subset of routes per request, but at framework boot we don't yet have a
 * per-request module list, so we emit the full set. This matches the behavior
 * of a non-streaming build.
 */
export function loadProdCssAssets(clientBuildDir: string): CssAssets {
  const manifestPath = path.resolve(process.cwd(), clientBuildDir, '.vite', 'ssr-manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { hrefs: [], source: 'prod' };
  }

  let manifest: SsrManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SsrManifest;
  } catch (error) {
    console.warn('Modelence SSR: failed to parse ssr-manifest.json', error);
    return { hrefs: [], source: 'prod' };
  }

  const hrefSet = new Set<string>();
  for (const assets of Object.values(manifest)) {
    if (!Array.isArray(assets)) {
      continue;
    }
    for (const asset of assets) {
      if (typeof asset === 'string' && CSS_EXTENSION_REGEX.test(asset)) {
        hrefSet.add(asset);
      }
    }
  }

  return { hrefs: Array.from(hrefSet), source: 'prod' };
}

/**
 * Render the CSS asset URLs as HTML <link rel="stylesheet"> tags. React 19
 * users who render <link precedence=...> inside components get React Float's
 * dedup + ordering automatically; this helper exists for the framework-level
 * tags injected into the template <head> before the React shell.
 */
export function renderStylesheetLinks(assets: CssAssets): string {
  if (assets.hrefs.length === 0) {
    return '';
  }
  return assets.hrefs
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join('');
}

/**
 * Build a Link header value for HTTP 103 Early Hints. The browser starts the
 * stylesheet fetch as soon as it sees this response, before the SSR render
 * has even begun.
 */
export function buildEarlyHintsLink(assets: CssAssets): string[] {
  return assets.hrefs.map((href) => `<${href}>; rel=preload; as=style`);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
