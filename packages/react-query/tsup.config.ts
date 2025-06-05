import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: {
      index: 'src/index.ts'
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
    '@tanstack/react-query',
    'modelence'
  ]
})); 