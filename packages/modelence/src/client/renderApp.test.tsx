import { renderApp } from './renderApp';

describe('client/renderApp', () => {
  describe('renderApp', () => {
    it('should export renderApp function', () => {
      expect(renderApp).toBeDefined();
      expect(typeof renderApp).toBe('function');
    });
  });
});
