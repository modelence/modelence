import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/globalSetup.ts'],
    // The bin tests spawn real Node processes and servers.
    testTimeout: 20_000,
  },
});
