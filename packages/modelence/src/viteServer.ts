import {
  createServer,
  defineConfig,
  ViteDevServer,
  loadConfigFromFile,
  UserConfig,
  mergeConfig,
  Plugin,
  PluginOption,
} from 'vite';
import reactPlugin from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import express from 'express';
import type { AppServer, AppServerInitOptions, ExpressMiddleware } from './types';
import { escapeJsonForScript } from './ssr/escapeJsonForScript';

const CLIENT_BUILD_DIR = './.modelence/build/client'.replace(/\\/g, '/');
const SSR_BUILD_DIR = './.modelence/build/ssr'.replace(/\\/g, '/');
// Resolved relative to Vite's `root` (./src/client) — see getConfig() below.
const SSR_ENTRY_VIRTUAL_PATH = '/index.tsx';
// Matches the empty `<div id="root"></div>` placeholder shipped in the Vite
// HTML template. Allowing whitespace inside keeps it tolerant of formatting
// without becoming greedy across unrelated `</div>` tags.
const ROOT_PLACEHOLDER_REGEX = /<div id="root">\s*<\/div>/;
const HEAD_CLOSE_TAG = '</head>';

class ViteServer implements AppServer {
  private viteServer?: ViteDevServer;
  private config?: UserConfig;
  private ssrEnabled = false;
  private ssrTransportInstalled = false;
  private prodEntryLoaded = false;
  // Computed once at first SSR request in prod (the manifest is immutable
  // after build). Dev mode recomputes per request because HMR can shift the
  // module graph.
  private prodCssAssetsCache?: import('./ssr/collectCss').CssAssets;
  // Same rationale as `prodCssAssetsCache`: the built index.html is immutable
  // after build, so cache it to avoid a sync fs read on every request.
  private prodTemplateCache?: string;

  enableSsr() {
    this.ssrEnabled = true;
  }

  async init({ httpServer }: AppServerInitOptions) {
    this.config = await getConfig(this.isDev() ? httpServer : undefined, { ssr: this.ssrEnabled });
    if (this.isDev()) {
      console.log('Starting Vite dev server...');
      this.viteServer = await createServer(this.config);
    }

    if (this.ssrEnabled && !this.ssrTransportInstalled) {
      const { installSsrCallMethodTransport } = await import('./ssr/transport');
      installSsrCallMethodTransport();
      this.ssrTransportInstalled = true;
    }
  }

  middlewares(): ExpressMiddleware[] {
    if (this.isDev()) {
      return (this.viteServer?.middlewares ?? []) as ExpressMiddleware[];
    }

    // `index: false` prevents express.static from auto-serving the built
    // `index.html` for directory requests (notably `/`). With SSR enabled,
    // the SSR handler must own document requests so it can render the React
    // tree; without it, `/` would be intercepted here and never reach the
    // SSR pipeline. Asset requests under `/assets/*` still serve normally.
    const staticOptions = this.ssrEnabled ? { index: false } : undefined;
    const staticFolders = [express.static(CLIENT_BUILD_DIR, staticOptions)];
    if (this.config?.publicDir) {
      staticFolders.push(express.static(this.config.publicDir, staticOptions));
    }
    return staticFolders;
  }

  async handler(req: express.Request, res: express.Response) {
    if (this.ssrEnabled && isDocumentRequest(req)) {
      // HEAD requests get headers only — no point running the full SSR
      // pipeline (DB call + React render + dehydration) just to have Node
      // strip the body downstream. Headers match what a GET would emit so
      // caches and probes see the same cacheability signals.
      if (req.method === 'HEAD') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).end();
        return;
      }

      try {
        await this.handleSsr(req, res);
      } catch (error) {
        if (this.isDev() && this.viteServer && error instanceof Error) {
          this.viteServer.ssrFixStacktrace(error);
        }
        console.error('SSR render error:', {
          url: req.originalUrl,
          method: req.method,
          userAgent: req.get('user-agent'),
          error,
        });
        // If we've already started streaming the response, we can't recover —
        // just terminate so the client gets a truncated (but usable) page.
        if (res.headersSent) {
          res.end();
          return;
        }
        // Fall back to CSR shell so the client can still recover.
        this.serveStaticShell(res);
      }
      return;
    }

    if (this.ssrEnabled) {
      res.status(404).end();
      return;
    }

    this.serveStaticShell(res);
  }

  private async handleSsr(req: express.Request, res: express.Response) {
    const template = await this.getTemplate(req.originalUrl);
    const snapshot = await this.captureSsrSnapshot();
    if (!snapshot) {
      throw new Error(
        'Modelence SSR is enabled but no SSR snapshot was captured. ' +
          "Make sure 'src/client/index.tsx' calls renderApp(...) from 'modelence/client'."
      );
    }

    // Lazy imports keep react-dom/server (and friends) out of the boot path
    // for non-SSR requests.
    const [{ renderSsrTreeStream }, { getCallContext }, cssModule] = await Promise.all([
      import('./ssr/render'),
      import('./app/server'),
      import('./ssr/collectCss'),
    ]);

    const callContext = await getCallContext(req, res);

    const cssAssets = this.collectCssAssets(cssModule);

    // 103 Early Hints — tell the browser to start fetching the stylesheets
    // before the SSR render has even begun. No-op if the platform doesn't
    // support it (older Node, proxies that strip 1xx, etc.).
    sendEarlyHints(res, cssModule.buildEarlyHintsLink(cssAssets));

    const { sessionState, pipe, getQueryState } = await renderSsrTreeStream({
      callContext,
      loadingElement: snapshot.loadingElement,
      routesElement: snapshot.routesElement,
      router: snapshot.router,
      location: req.originalUrl,
    });

    // Split the template at the `<div id="root">` placeholder. The head
    // (plus opening body) flushes immediately with CSS links inlined; React
    // then streams the shell into the placeholder; the closing template
    // (plus dehydrated query state) flushes after the stream finishes.
    if (!ROOT_PLACEHOLDER_REGEX.test(template)) {
      throw new Error('SSR template is missing the expected `<div id="root"></div>` placeholder.');
    }
    const [rawPrelude, rawEpilogue] = splitTemplateAtRoot(template);
    const prelude = injectStylesheets(rawPrelude, cssModule.renderStylesheetLinks(cssAssets));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200);

    // Flush prelude (head with CSS + opening shell up to `<div id="root">`)
    // and the session state script. Session state is fully resolved before
    // the React render starts, so it's safe to inline up front.
    res.write(prelude);
    res.write(
      `<script id="__MODELENCE_STATE__" type="application/json">${escapeJsonForScript(
        sessionState
      )}</script>`
    );
    res.write('<div id="root">');

    await pipe(res as unknown as import('node:stream').Writable);

    // Stream finished — close out the root container, emit the dehydrated
    // query state, and write the rest of the template. The state script
    // appears after </div> but before </body>; client hydration reads it
    // via getElementById, so order doesn't matter for correctness.
    res.write('</div>');
    res.write(
      `<script id="__MODELENCE_QUERY_STATE__" type="application/json">${escapeJsonForScript(
        getQueryState()
      )}</script>`
    );
    res.end(rawEpilogue);
  }

  private collectCssAssets(
    cssModule: typeof import('./ssr/collectCss')
  ): import('./ssr/collectCss').CssAssets {
    if (this.isDev()) {
      if (!this.viteServer) {
        return { hrefs: [], source: 'dev' };
      }
      return cssModule.collectDevCssAssets(this.viteServer, SSR_ENTRY_VIRTUAL_PATH);
    }

    if (!this.prodCssAssetsCache) {
      this.prodCssAssetsCache = cssModule.loadProdCssAssets(CLIENT_BUILD_DIR);
    }
    return this.prodCssAssetsCache;
  }

  private async getTemplate(url: string): Promise<string> {
    if (this.isDev()) {
      const templatePath = path.resolve(process.cwd(), 'src/client/index.html');
      let template = fs.readFileSync(templatePath, 'utf-8');
      if (this.viteServer) {
        template = await this.viteServer.transformIndexHtml(url, template);
      }
      return template;
    }

    if (!this.prodTemplateCache) {
      const templatePath = path.resolve(process.cwd(), CLIENT_BUILD_DIR, 'index.html');
      this.prodTemplateCache = fs.readFileSync(templatePath, 'utf-8');
    }
    return this.prodTemplateCache;
  }

  private async captureSsrSnapshot(): Promise<
    import('./client/renderApp').RenderAppOptions | null
  > {
    // Evaluating the user's entry runs its top-level renderApp(...) which
    // populates the SSR snapshot. Read the snapshot synchronously right
    // after evaluation so concurrent requests can't overwrite it on
    // globalThis between the load and the read.
    const { _getSsrSnapshot } = await import('./client/renderApp');

    if (this.isDev()) {
      // Re-evaluate every request so dev-mode HMR edits apply.
      if (!this.viteServer) {
        throw new Error('Vite dev server not initialized');
      }
      await this.viteServer.ssrLoadModule(SSR_ENTRY_VIRTUAL_PATH);
      return _getSsrSnapshot();
    }

    // In production, Node caches the dynamic import. Evaluate exactly once
    // so the snapshot is populated on first request and reused thereafter.
    if (!this.prodEntryLoaded) {
      await import(path.resolve(process.cwd(), SSR_BUILD_DIR, 'index.mjs'));
      this.prodEntryLoaded = true;
    }
    return _getSsrSnapshot();
  }

  private serveStaticShell(res: express.Response) {
    if (this.isDev()) {
      try {
        // Prevent browser from caching the HTML entrypoint in dev mode.
        // Vite's transformMiddleware uses no-cache + ETag for .ts/.tsx modules,
        // which revalidates correctly. But the HTML served by Express's sendFile
        // can be cached by the browser (e.g. bfcache on back/forward navigation).
        // Without HMR WebSocket, stale HTML leads to dynamic import() URLs that
        // reference modules the current Vite instance doesn't recognize.
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile('index.html', { root: './src/client' });
      } catch (e) {
        console.error('Error serving index.html:', e);
        res.status(500).send('Internal Server Error');
      }
    } else {
      res.sendFile('index.html', { root: CLIENT_BUILD_DIR });
    }
  }

  private isDev() {
    return process.env.NODE_ENV !== 'production';
  }
}

function isDocumentRequest(req: express.Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  // The Accept header is advisory, not authoritative. Browsers always include
  // `text/html`, but health checks, `curl`, and similar non-browser clients
  // commonly send `*/*` or no Accept at all. Treat the request as a document
  // unless the client *explicitly* asked for something other than HTML
  // (e.g. `Accept: application/json`). Path-based filters below (`/api/`,
  // non-HTML extensions) catch the truly non-document cases.
  const accept = req.get('accept') ?? '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return false;
  }

  const pathname = (req.path ?? req.url ?? '').split('?')[0];

  // API endpoints never produce HTML, even when a curious client sends an
  // Accept header that includes text/html.
  if (pathname.startsWith('/api/')) {
    return false;
  }

  // Skip URLs with non-HTML extensions (dev-tools probes, favicons, sourcemaps).
  const lastSegment = pathname.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = lastSegment.slice(dotIndex).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      return false;
    }
  }

  return true;
}

/**
 * Split the HTML template at the `<div id="root">` placeholder so the head
 * can stream first and the React shell can pipe directly into the response.
 */
function splitTemplateAtRoot(template: string): [string, string] {
  const match = template.match(ROOT_PLACEHOLDER_REGEX);
  if (!match || match.index === undefined) {
    throw new Error('SSR template is missing the expected `<div id="root"></div>` placeholder.');
  }
  const prelude = template.slice(0, match.index);
  const epilogue = template.slice(match.index + match[0].length);
  return [prelude, epilogue];
}

/**
 * Inject CSS <link> tags just before `</head>` so styles arrive in the first
 * flushed chunk. Falls back to prepending the prelude if no `</head>` is found
 * (templates may legitimately omit it — the browser will still load the
 * stylesheet, it just won't be in the head).
 */
function injectStylesheets(prelude: string, linksHtml: string): string {
  if (!linksHtml) {
    return prelude;
  }
  const headCloseIndex = prelude.lastIndexOf(HEAD_CLOSE_TAG);
  if (headCloseIndex === -1) {
    return linksHtml + prelude;
  }
  return prelude.slice(0, headCloseIndex) + linksHtml + prelude.slice(headCloseIndex);
}

type EarlyHintsCapable = {
  writeEarlyHints?: (hints: { link?: string | string[] }) => void;
};

/**
 * Emit HTTP 103 Early Hints with CSS preload Link headers when the runtime
 * supports it (Node 18.11+). The browser will start fetching stylesheets
 * before the SSR render begins. Safe to call unconditionally — older Node
 * versions and proxies that strip 1xx simply ignore it.
 */
function sendEarlyHints(res: express.Response, links: string[]) {
  if (links.length === 0) {
    return;
  }
  const target = res as unknown as EarlyHintsCapable;
  if (typeof target.writeEarlyHints !== 'function') {
    return;
  }
  try {
    target.writeEarlyHints({ link: links });
  } catch (error) {
    // Some proxy frontends (or future Node versions in error states) may
    // reject 1xx after headers have been touched. Treat as best-effort.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Modelence SSR: writeEarlyHints failed', error);
    }
  }
}

async function loadUserViteConfig() {
  const appDir = process.cwd();

  try {
    const result = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      undefined,
      appDir
    );
    return result?.config || {};
  } catch (error) {
    console.warn(`Could not load vite config:`, error);
    return {};
  }
}

function safelyMergeConfig(baseConfig: UserConfig, userConfig: UserConfig) {
  const mergedConfig = mergeConfig(baseConfig, userConfig);

  // Deduplicate plugins by name, keeping user plugins over framework plugins
  if (mergedConfig.plugins && Array.isArray(mergedConfig.plugins)) {
    const seenPlugins = new Set<string>();
    mergedConfig.plugins = mergedConfig.plugins
      .flat()
      .filter((plugin: PluginOption) => {
        if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
          return true;
        }
        const pluginName = (plugin as Plugin).name;
        if (!pluginName || seenPlugins.has(pluginName)) {
          return false;
        }
        seenPlugins.add(pluginName);
        return true;
      })
      .reverse(); // Reverse to prioritize user plugins over framework plugins
    mergedConfig.plugins.reverse(); // Reverse back to maintain original order
  }

  return mergedConfig;
}

async function getConfig(httpServer?: import('http').Server, options: { ssr?: boolean } = {}) {
  const appDir = process.cwd();
  const userConfig = await loadUserViteConfig();

  const eslintConfigFile = [
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc',
    'eslint.config.js',
    '.eslintrc.yml',
    '.eslintrc.yaml',
  ].find((file) => fs.existsSync(path.join(appDir, file)));

  const plugins = [reactPlugin(), modelenceAssetPlugin()];

  if (eslintConfigFile) {
    const eslintPlugin = (await import('vite-plugin-eslint')).default;
    plugins.push(
      eslintPlugin({
        failOnError: false,
        include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
        cwd: appDir,
        overrideConfigFile: path.resolve(appDir, eslintConfigFile),
      })
    );
  }

  const baseConfig = defineConfig({
    plugins,
    build: {
      outDir: CLIENT_BUILD_DIR,
      emptyOutDir: true,
    },
    server: {
      middlewareMode: true,
      hmr: httpServer ? { server: httpServer } : undefined,
    },
    appType: options.ssr ? 'custom' : 'spa',
    root: './src/client',
    resolve: {
      alias: {
        '@': path.resolve(appDir, 'src').replace(/\\/g, '/'),
      },
    },
  });

  return safelyMergeConfig(baseConfig, userConfig);
}

function modelenceAssetPlugin(): Plugin {
  return {
    name: 'modelence-asset-handler',
    async transform(code: string, id: string) {
      const assetRegex = /\.(png|jpe?g|gif|svg|mpwebm|ogg|mp3|wav|flac|aac)$/;
      if (assetRegex.test(id)) {
        if (process.env.NODE_ENV === 'development') {
          return code;
        }
        // TODO: Upload to CDN
        // return `export default "${cdnUrl}"`;
        return code;
      }
    },
  };
}

export const viteServer = new ViteServer();
