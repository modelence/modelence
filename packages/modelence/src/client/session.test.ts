import { useSession } from './session';

describe('client/session', () => {
  describe('useSession', () => {
    it('should export useSession hook', () => {
      expect(useSession).toBeDefined();
      expect(typeof useSession).toBe('function');
    });
  });
});
