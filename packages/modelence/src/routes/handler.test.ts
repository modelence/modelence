import { createRouteHandler } from './handler';

describe('routes/handler', () => {
  describe('createRouteHandler', () => {
    it('should export createRouteHandler function', () => {
      expect(createRouteHandler).toBeDefined();
      expect(typeof createRouteHandler).toBe('function');
    });

    it('should create a route handler function', () => {
      const handler = createRouteHandler('GET', '/test', async () => ({
        status: 200,
        data: { message: 'test' },
      }));

      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });
});
