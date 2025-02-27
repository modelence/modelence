import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['index.ts', 'client.ts', 'server.ts', 'mongo.ts', 'bin/modelence.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: {
      index: 'index.ts',
      client: 'client.ts',
      server: 'server.ts',
      mongo: 'mongo.ts'
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
