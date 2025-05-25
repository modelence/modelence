import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  minify: !options.watch,
  treeshake: !options.watch,
  external: ['react', 'react-dom']
})); 