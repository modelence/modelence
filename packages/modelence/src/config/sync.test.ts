import { startConfigSync } from './sync';

describe('config/sync', () => {
  describe('startConfigSync', () => {
    it('should export startConfigSync function', () => {
      expect(startConfigSync).toBeDefined();
      expect(typeof startConfigSync).toBe('function');
    });

    it('should not throw when called', () => {
      expect(() => {
        startConfigSync();
      }).not.toThrow();
    });
  });
});
