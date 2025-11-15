import type { ModelenceConfig } from './types';

describe('types', () => {
  test('should have valid ModelenceConfig type', () => {
    const config: ModelenceConfig = {
      serverDir: './server',
      serverEntry: 'index.ts',
    };
    expect(config.serverDir).toBe('./server');
    expect(config.serverEntry).toBe('index.ts');
  });
});
