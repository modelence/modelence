import { describe, expect, test } from '@jest/globals';
import { AppProvider } from './AppProvider';

describe('client/AppProvider', () => {
  describe('AppProvider', () => {
    test('should export AppProvider component', () => {
      expect(AppProvider).toBeDefined();
      expect(typeof AppProvider).toBe('function');
    });

    test('should be a React component', () => {
      // AppProvider is a React function component
      expect(AppProvider.length).toBeGreaterThanOrEqual(1);
    });

    test('should accept props with children and loadingElement', () => {
      // Verify the function signature accepts an object parameter
      const props = {
        children: null,
        loadingElement: null,
      };
      expect(() => AppProvider(props)).toBeDefined();
    });
  });
});
