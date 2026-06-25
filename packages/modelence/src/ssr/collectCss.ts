import path from 'path';
import fs from 'fs';
import type { ViteDevServer, ModuleNode } from 'vite';

const CSS_EXTENSION_REGEX = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)(\?|$)/;

export type CssAssetSource = 'dev' | 'prod';

export interface CssAssets {
  /** URLs for `<link rel="stylesheet">`. Dev: Vite transform; prod: built asset. */
  hrefs: string[];
  source: CssAssetSource;
}

const EMPTY_ASSETS: CssAssets = Object.freeze({ hrefs: [], source: 'dev' }) as CssAssets;

// Walks the dev module graph from the SSR entry to gather CSS hrefs the
// browser can fetch directly, killing FOUC in dev.
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
  return path.join(root, entryVirtualPath).replace(/\\/g, '/');
}

type SsrManifest = Record<string, string[]>;

// Flatten all CSS hrefs from the SSR manifest. Per-request filtering would
// be ideal but we don't have the rendered module list at boot, so emit all.
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

export function renderStylesheetLinks(assets: CssAssets): string {
  if (assets.hrefs.length === 0) {
    return '';
  }
  return assets.hrefs
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join('');
}

// Link header values for 103 Early Hints (preload CSS before render starts).
export function buildEarlyHintsLink(assets: CssAssets): string[] {
  return assets.hrefs.map((href) => `<${href}>; rel=preload; as=style`);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
