import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['index.ts', 'client.ts', 'server.ts', 'cli/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: {
      index: 'index.ts',
      client: 'client.ts',
      server: 'server.ts',
      cli: 'cli/index.ts'
    }
  },
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
    'react',
    'react-dom'
  ]
}));
