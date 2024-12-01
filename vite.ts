import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import eslint from 'vite-plugin-eslint';
import path from 'path';
import fs from 'fs';

export function defineViteConfig() {
  const appDir = process.cwd();

  const eslintConfigFile = [
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc',
    'eslint.config.js',
    '.eslintrc.yml',
    '.eslintrc.yaml'
  ].find(file => fs.existsSync(path.join(appDir, file)));

  const plugins = [react(), modelenceAssetPlugin()];

  if (eslintConfigFile) {
    plugins.push(
      eslint({
        failOnError: false,
        include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
        cwd: appDir,
        overrideConfigFile: path.resolve(appDir, eslintConfigFile)
      })
    );
  }

  return defineConfig({
    plugins,
    root: appDir,
    build: {
      outDir: '.modelence/client',
      emptyOutDir: true
    },
    server: {
      proxy: {
        '/api': 'http://localhost:4000'
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(appDir, 'src')
      }

    }
  })
}

function modelenceAssetPlugin() {
  return  {
    name: 'modelence-asset-handler',
    async transform(code, id) {
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
    async generateBundle(options, bundle) {
      // Handle asset URLs in the final bundle
    }
  };
}
