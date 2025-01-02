import { createServer, defineConfig } from 'vite';
import reactPlugin from '@vitejs/plugin-react';
import eslintPlugin from 'vite-plugin-eslint';
import path from 'path';
import fs from 'fs';
import express from 'express';

export async function initViteServer(app: express.Application, isDev: boolean) {
  if (isDev) {
    console.log('Starting Vite dev server...');
    const vite = await createServer({
      ...defineConfig(await getConfig()),
      server: {
        middlewareMode: true,
      },
      root: './src/client'
    });
    
    app.use(vite.middlewares);
    
    app.use('*', async (req: express.Request, res: express.Response) => {
      try {
        res.sendFile('index.html', { root: './src/client' });
      } catch (e) {
        console.error('Error serving index.html:', e);
        res.status(500).send('Internal Server Error');
      }
    });
  } else {
    app.use(express.static('.modelence/client'));
    app.get('*', (req, res) => {
      res.sendFile('index.html', { root: '.modelence/client' });
    });
  }
}

async function getConfig() {
  const appDir = process.cwd();

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
    plugins.push(
      eslintPlugin({
        failOnError: false,
        include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
        cwd: appDir,
        overrideConfigFile: path.resolve(appDir, eslintConfigFile)
      })
    );
  }

  return {
    plugins,
    root: appDir,
    build: {
      outDir: '.modelence/client',
      emptyOutDir: true
    },
    server: {
      proxy: {
        '/api': 'http://localhost:4000'
      },
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      hmr: {
        port: 0,
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(appDir, 'src')
      }

    }
  };
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
