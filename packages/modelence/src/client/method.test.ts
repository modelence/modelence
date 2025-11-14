import { callMethod } from './method';

describe('client/method', () => {
  describe('callMethod', () => {
    it('should export callMethod function', () => {
      expect(callMethod).toBeDefined();
      expect(typeof callMethod).toBe('function');
    });
  });
});
