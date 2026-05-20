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
// Resolved relative to Vite's `root` (./src/client).
const SSR_ENTRY_VIRTUAL_PATH = '/index.tsx';
const ROOT_PLACEHOLDER_REGEX = /<div id="root">\s*<\/div>/;
const HEAD_CLOSE_TAG = '</head>';

class ViteServer implements AppServer {
  private viteServer?: ViteDevServer;
  private config?: UserConfig;
  private ssrEnabled = false;
  private ssrTransportInstalled = false;
  private prodEntryLoaded = false;
  // Manifest and template are immutable after build; cache to avoid sync fs
  // reads per request. Dev mode recomputes because HMR can shift the graph.
  private prodCssAssetsCache?: import('./ssr/collectCss').CssAssets;
  private prodTemplateCache?: string;

  enableSsr() {
    this.ssrEnabled = true;
  }

  async init({ httpServer }: AppServerInitOptions) {
    this.config = await getConfig(this.isDev() ? httpServer : undefined, { ssr: this.ssrEnabled });
    if (this.isDev()) {
      console.log('Starting Vite dev server...');
      this.viteServer = await createServer(this.config);
    } else if (this.ssrEnabled) {
      // `postBuildCommand` skips the Vite SSR build, so check upfront instead
      // of crashing on the first document request with a "Cannot find module".
      const ssrEntryPath = path.resolve(process.cwd(), SSR_BUILD_DIR, 'index.mjs');
      if (!fs.existsSync(ssrEntryPath)) {
        throw new Error(
          `Modelence: SSR is enabled (startApp({ ssr: true })) but the SSR ` +
            `bundle is missing at ${ssrEntryPath}.\n\n` +
            `This usually means \`postBuildCommand\` is set in modelence.config.ts, ` +
            `which replaces the default Vite client build (and the SSR build along ` +
            `with it). Either:\n` +
            `  • remove \`postBuildCommand\` so Modelence builds the SSR bundle, or\n` +
            `  • remove \`ssr: true\` from startApp() if your custom toolchain ` +
            `handles SSR itself.`
        );
      }
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

    // `index: false` stops express.static from auto-serving `index.html`
    // for `/`, which would shadow the SSR handler. Asset requests still serve.
    const staticOptions = this.ssrEnabled ? { index: false } : undefined;
    const staticFolders = [express.static(CLIENT_BUILD_DIR, staticOptions)];
    if (this.config?.publicDir) {
      staticFolders.push(express.static(this.config.publicDir, staticOptions));
    }
    return staticFolders;
  }

  async handler(req: express.Request, res: express.Response) {
    if (this.ssrEnabled && isDocumentRequest(req)) {
      // Skip the SSR pipeline for HEAD — Node strips the body anyway.
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
        // Mid-stream: can't recover; terminate with a truncated page.
        if (res.headersSent) {
          res.end();
          return;
        }
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

    // Lazy: keep react-dom/server off the boot path for non-SSR requests.
    const [{ renderSsrTreeStream }, { getCallContext }, cssModule] = await Promise.all([
      import('./ssr/render'),
      import('./app/server'),
      import('./ssr/collectCss'),
    ]);

    const callContext = await getCallContext(req, res);

    const cssAssets = this.collectCssAssets(cssModule);

    // 103 Early Hints so the browser prefetches CSS during render. No-op on
    // older Node / proxies that strip 1xx.
    sendEarlyHints(res, cssModule.buildEarlyHintsLink(cssAssets));

    const { sessionState, pipe, getQueryState } = await renderSsrTreeStream({
      callContext,
      loadingElement: snapshot.loadingElement,
      routesElement: snapshot.routesElement,
      router: snapshot.router,
      location: req.originalUrl,
    });

    if (!ROOT_PLACEHOLDER_REGEX.test(template)) {
      throw new Error('SSR template is missing the expected `<div id="root"></div>` placeholder.');
    }
    const [rawPrelude, rawEpilogue] = splitTemplateAtRoot(template);
    const prelude = injectStylesheets(rawPrelude, cssModule.renderStylesheetLinks(cssAssets));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200);

    // Flush head + session state up front; session is resolved before render.
    res.write(prelude);
    res.write(
      `<script id="__MODELENCE_STATE__" type="application/json">${escapeJsonForScript(
        sessionState
      )}</script>`
    );
    res.write('<div id="root">');

    await pipe(res as unknown as import('node:stream').Writable);

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
    // Evaluating the entry runs `renderApp(...)`, which stores the snapshot
    // on globalThis. Read it immediately after evaluation.
    const { _getSsrSnapshot } = await import('./client/renderApp');

    if (this.isDev()) {
      // Re-evaluate per request so HMR edits apply.
      if (!this.viteServer) {
        throw new Error('Vite dev server not initialized');
      }
      await this.viteServer.ssrLoadModule(SSR_ENTRY_VIRTUAL_PATH);
      return _getSsrSnapshot();
    }

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

  // Treat as a document unless the client explicitly asked for something
  // other than HTML. `*/*` and missing Accept (curl, health checks) count
  // as document-ok; path-based filters below catch the genuinely non-doc cases.
  const accept = req.get('accept') ?? '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return false;
  }

  const pathname = (req.path ?? req.url ?? '').split('?')[0];

  if (pathname.startsWith('/api/')) {
    return false;
  }

  // Non-HTML extensions: favicons, sourcemaps, asset probes.
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

function splitTemplateAtRoot(template: string): [string, string] {
  const match = template.match(ROOT_PLACEHOLDER_REGEX);
  if (!match || match.index === undefined) {
    throw new Error('SSR template is missing the expected `<div id="root"></div>` placeholder.');
  }
  const prelude = template.slice(0, match.index);
  const epilogue = template.slice(match.index + match[0].length);
  return [prelude, epilogue];
}

// Insert CSS <link>s before </head> so styles ship with the first chunk.
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

// 103 Early Hints (Node 18.11+); no-op when unsupported or proxies strip 1xx.
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
    // Best-effort: some proxies reject 1xx after headers are touched.
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
