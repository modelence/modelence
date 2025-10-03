import { createServer, defineConfig, ViteDevServer, loadConfigFromFile, UserConfig, mergeConfig } from 'vite';
import reactPlugin from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import express from 'express';
import type { AppServer, ExpressMiddleware } from './types';

class ViteServer implements AppServer {
  private viteServer?: ViteDevServer;
  private config?: UserConfig;

  async init() {
    this.config = await getConfig();
    if (this.isDev()) {
      console.log('Starting Vite dev server...');
      this.viteServer = await createServer(this.config); 
    }
  }

  middlewares(): ExpressMiddleware[] {
    if (this.isDev()) {
      return (this.viteServer?.middlewares ?? []) as ExpressMiddleware[];
    }
    
    const staticFolders = [express.static('./.modelence/build/client'.replace(/\\/g, '/'))];
    if (this.config?.publicDir) {
      staticFolders.push(express.static(this.config.publicDir));
    }
    return staticFolders;
  }

  handler(req: express.Request, res: express.Response) {
    if (this.isDev()) {
      try {
        res.sendFile('index.html', { root: './src/client' });
      } catch (e) {
        console.error('Error serving index.html:', e);
        res.status(500).send('Internal Server Error');
      }
    } else {
      res.sendFile('index.html', { root: './.modelence/build/client'.replace(/\\/g, '/') });
    }
  }

  private isDev() {
    return process.env.NODE_ENV !== 'production';
  }
}

async function loadUserViteConfig() {
  const appDir = process.cwd();
  
  try {
    const result = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, appDir);
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
    const seenPlugins = new Set();
    mergedConfig.plugins = mergedConfig.plugins.filter((plugin: any) => {
      if (!plugin || typeof plugin !== 'object') {
        return true;
      }
      const pluginName = plugin.name;
      if (!pluginName || seenPlugins.has(pluginName)) {
        return false;
      }
      seenPlugins.add(pluginName);
      return true;
    }).reverse(); // Reverse to prioritize user plugins over framework plugins
    mergedConfig.plugins.reverse(); // Reverse back to maintain original order
  }
  
  return mergedConfig;
}

async function getConfig() {
  const appDir = process.cwd();
  const userConfig = await loadUserViteConfig();

  const eslintConfigFile = [
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc',
    'eslint.config.js',
    '.eslintrc.yml',
    '.eslintrc.yaml'
  ].find(file => fs.existsSync(path.join(appDir, file)));

  const plugins = [reactPlugin(), modelenceAssetPlugin()];

  if (eslintConfigFile) {
    const eslintPlugin = (await import('vite-plugin-eslint')).default;
    plugins.push(
      eslintPlugin({
        failOnError: false,
        include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
        cwd: appDir,
        overrideConfigFile: path.resolve(appDir, eslintConfigFile)
      })
    );
  }

  const baseConfig = defineConfig({
    plugins,
    build: {
      outDir: '.modelence/build/client'.replace(/\\/g, '/'),
      emptyOutDir: true
    },
    server: {
      middlewareMode: true,
    },
    root: './src/client',
    resolve: {
      alias: {
        '@': path.resolve(appDir, 'src').replace(/\\/g, '/')
      }
    },
  });

  return safelyMergeConfig(baseConfig, userConfig);
}

function modelenceAssetPlugin() {
  return  {
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
    async generateBundle(options: any, bundle: any) {
      // Handle asset URLs in the final bundle
    }
  };
}

export const viteServer = new ViteServer();
