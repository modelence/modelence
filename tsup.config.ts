import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['index.ts', 'client.ts', 'server.ts'],
  format: ['esm'],
  dts: true,
  splitting: true,
  minify: true,
  clean: true,
  outDir: 'dist',
  treeshake: true,
  esbuildOptions: (options) => {
    options.resolveExtensions = ['.ts', '.js', '.tsx', '.jsx']
    return options
  }
}) 