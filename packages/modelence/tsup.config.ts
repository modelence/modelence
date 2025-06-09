import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['src/index.ts', 'src/client.ts', 'src/server.ts', 'src/telemetry.ts', 'src/mongo.ts', 'src/bin/modelence.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: {
      index: 'src/index.ts',
      client: 'src/client.ts',
      server: 'src/server.ts',
      telemetry: 'src/telemetry.ts',
      mongo: 'src/mongo.ts'
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
  exclude: ['./src/node_modules/**/*', './dist/**/*'],
  external: [
    'react',
    'react-dom'
  ]
}));
