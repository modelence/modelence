import { getClient, getMongodbUri } from './client';

describe('db/client', () => {
  describe('getClient', () => {
    it('should return null initially', () => {
      expect(getClient()).toBeNull();
    });

    it('should be a function', () => {
      expect(typeof getClient).toBe('function');
    });
  });

  describe('getMongodbUri', () => {
    it('should be a function', () => {
      expect(typeof getMongodbUri).toBe('function');
    });

    it('should return undefined when config is not set', () => {
      const result = getMongodbUri();
      expect(result).toBeUndefined();
    });
  });
});
