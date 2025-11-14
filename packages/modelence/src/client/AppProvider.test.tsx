import { AppProvider } from './AppProvider';

describe('client/AppProvider', () => {
  describe('AppProvider', () => {
    it('should export AppProvider component', () => {
      expect(AppProvider).toBeDefined();
      expect(typeof AppProvider).toBe('function');
    });
  });
});
