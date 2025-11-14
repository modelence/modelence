import { logDebug, logInfo, logError, startTransaction } from './index';

describe('telemetry/index', () => {
  describe('logDebug', () => {
    it('should be a function', () => {
      expect(typeof logDebug).toBe('function');
    });

    it('should not throw when called', () => {
      expect(() => logDebug('test message', {})).not.toThrow();
    });

    it('should accept message and args', () => {
      expect(() => logDebug('test', { key: 'value' })).not.toThrow();
    });
  });

  describe('logInfo', () => {
    it('should be a function', () => {
      expect(typeof logInfo).toBe('function');
    });

    it('should not throw when called', () => {
      expect(() => logInfo('test message', {})).not.toThrow();
    });

    it('should accept message and args', () => {
      expect(() => logInfo('test', { key: 'value' })).not.toThrow();
    });
  });

  describe('logError', () => {
    it('should be a function', () => {
      expect(typeof logError).toBe('function');
    });

    it('should not throw when called', () => {
      expect(() => logError('test error', {})).not.toThrow();
    });

    it('should accept message and args', () => {
      expect(() => logError('error', { error: 'details' })).not.toThrow();
    });
  });

  describe('startTransaction', () => {
    it('should be a function', () => {
      expect(typeof startTransaction).toBe('function');
    });

    it('should return a transaction object', () => {
      const transaction = startTransaction('method', 'test');
      expect(transaction).toBeDefined();
      expect(typeof transaction.end).toBe('function');
      expect(typeof transaction.setContext).toBe('function');
    });

    it('should accept different transaction types', () => {
      expect(() => startTransaction('method', 'test')).not.toThrow();
      expect(() => startTransaction('cron', 'test')).not.toThrow();
      expect(() => startTransaction('ai', 'test')).not.toThrow();
      expect(() => startTransaction('custom', 'test')).not.toThrow();
      expect(() => startTransaction('route', 'test')).not.toThrow();
    });

    it('should accept optional context', () => {
      const transaction = startTransaction('method', 'test', { user: 'test' });
      expect(transaction).toBeDefined();
    });

    it('should allow calling end on transaction', () => {
      const transaction = startTransaction('method', 'test');
      expect(() => transaction.end()).not.toThrow();
      expect(() => transaction.end('success')).not.toThrow();
      expect(() => transaction.end('success', { result: 'ok' })).not.toThrow();
    });

    it('should allow calling setContext on transaction', () => {
      const transaction = startTransaction('method', 'test');
      expect(() => transaction.setContext({ key: 'value' })).not.toThrow();
    });
  });
});
