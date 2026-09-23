import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  // The oldest Node.js a Modelence Cloud image may run (MINIMUM_NODE_MAJOR
  // in Studio).
  target: 'node18',
  platform: 'node',
  dts: { entry: { index: 'src/index.ts' } },
  splitting: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  // Unminified: this runs as PID 1 in tenant containers, and its stack
  // traces should be readable in their logs.
  minify: false,
});
