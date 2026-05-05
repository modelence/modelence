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

const CLIENT_BUILD_DIR = './.modelence/build/client'.replace(/\\/g, '/');
const SSR_BUILD_DIR = './.modelence/build/ssr'.replace(/\\/g, '/');
// Resolved relative to Vite's `root` (./src/client) — see getConfig() below.
const SSR_ENTRY_VIRTUAL_PATH = '/index.tsx';
// Matches the empty `<div id="root"></div>` placeholder shipped in the Vite
// HTML template. Allowing whitespace inside keeps it tolerant of formatting
// without becoming greedy across unrelated `</div>` tags.
const ROOT_PLACEHOLDER_REGEX = /<div id="root">\s*<\/div>/;

class ViteServer implements AppServer {
  private viteServer?: ViteDevServer;
  private config?: UserConfig;
  private ssrEnabled = false;
  private ssrTransportInstalled = false;
  private prodEntryLoaded = false;

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

    const staticFolders = [express.static(CLIENT_BUILD_DIR)];
    if (this.config?.publicDir) {
      staticFolders.push(express.static(this.config.publicDir));
    }
    return staticFolders;
  }

  async handler(req: express.Request, res: express.Response) {
    if (this.ssrEnabled && isDocumentRequest(req)) {
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
    await this.evaluateUserSsrEntry();

    // Lazy imports keep react-dom/server out of the boot path for non-SSR requests.
    const [{ renderSsrTree }, { _getSsrSnapshot }, { getCallContext }] = await Promise.all([
      import('./ssr/render'),
      import('./client/renderApp'),
      import('./app/server'),
    ]);

    const callContext = await getCallContext(req, res);
    const snapshot = _getSsrSnapshot();
    if (!snapshot) {
      throw new Error(
        'Modelence SSR is enabled but no SSR snapshot was captured. ' +
          "Make sure 'src/client/index.tsx' calls renderApp(...) from 'modelence/client'."
      );
    }

    const { html, sessionState, queryState } = await renderSsrTree({
      callContext,
      loadingElement: snapshot.loadingElement,
      routesElement: snapshot.routesElement,
      router: snapshot.router,
      location: req.originalUrl,
    });

    const stateScripts =
      `<script id="__MODELENCE_STATE__" type="application/json">${escapeJsonForScript(sessionState)}</script>` +
      `<script id="__MODELENCE_QUERY_STATE__" type="application/json">${escapeJsonForScript(queryState)}</script>`;

    // The Vite template ships an empty `<div id="root"></div>` placeholder.
    // Match it explicitly to avoid the greedy/non-greedy pitfalls of `.*?`
    // when the template evolves. Function replacement avoids $&/$'/$$ being
    // interpreted by String.replace.
    if (!ROOT_PLACEHOLDER_REGEX.test(template)) {
      throw new Error('SSR template is missing the expected `<div id="root"></div>` placeholder.');
    }
    const finalHtml = template.replace(
      ROOT_PLACEHOLDER_REGEX,
      () => `<div id="root">${html}</div>${stateScripts}`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(finalHtml);
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

    const templatePath = path.resolve(process.cwd(), CLIENT_BUILD_DIR, 'index.html');
    return fs.readFileSync(templatePath, 'utf-8');
  }

  private async evaluateUserSsrEntry() {
    // Evaluating the user's entry runs its top-level renderApp(...) which
    // populates the SSR snapshot.
    if (this.isDev()) {
      // Re-evaluate every request so dev-mode HMR edits apply.
      if (!this.viteServer) {
        throw new Error('Vite dev server not initialized');
      }
      await this.viteServer.ssrLoadModule(SSR_ENTRY_VIRTUAL_PATH);
      return;
    }

    // In production, Node caches the dynamic import. Evaluate exactly once
    // so the snapshot is populated on first request and reused thereafter.
    if (this.prodEntryLoaded) {
      return;
    }
    await import(path.resolve(process.cwd(), SSR_BUILD_DIR, 'index.mjs'));
    this.prodEntryLoaded = true;
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

  const accept = req.get('accept') ?? '';
  if (!accept.includes('text/html')) {
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

export function escapeJsonForScript(json: string): string {
  // Escape </script>, HTML chars, and U+2028/U+2029 (illegal in JS source).
  // Single-pass replace avoids order-dependent double-escape pitfalls.
  return json.replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
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
