import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['index.ts', 'client.ts', 'server.ts'],
  format: ['esm'],
  dts: true,
  splitting: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  minify: !options.watch,
  treeshake: !options.watch,
  jsx: true,
  esbuildOptions: (options) => {
    options.resolveExtensions = ['.ts', '.js', '.tsx', '.jsx']
    return options
  },
  external: [
    'modelence',
    'modelence/client',
    'modelence/server'
  ]
}));
