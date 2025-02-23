import { getServerPath } from './config';
import { build as tsupBuild } from 'tsup';
import { build as viteBuild } from 'vite';
import path from 'path';

async function buildClient() {
  console.log('Building client with Vite...');
  await viteBuild({
    root: './src/client',
    build: {
      outDir: path.resolve(process.cwd(), '.modelence/build/client'),
      emptyOutDir: true
    }
  });
}

async function buildServer() {
  console.log('Building server with tsup...');
  return new Promise((resolve, reject) => {
    tsupBuild({
      entry: [getServerPath()],
      format: 'esm',
      outDir: '.modelence/build',
      clean: true,
      watch: false,
      bundle: true,
      treeshake: true,
      skipNodeModulesBundle: false,
      outExtension: ({ format }) => ({
        js: '.mjs'
      }),
      onSuccess: async () => { resolve(undefined); }
    });
  });
}

export async function build() {
  console.log('Building Modelence project...');
  
  try {
    await buildServer();
    await buildClient();
    
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}


/*

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '.modelence/build/client'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
*/