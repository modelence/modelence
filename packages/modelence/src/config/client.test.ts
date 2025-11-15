import { getConfig, _setConfig } from './client';
import type { Configs } from './types';

describe('config/client', () => {
  describe('getConfig', () => {
    it('should return undefined for non-existent config key', () => {
      _setConfig({});
      expect(getConfig('nonexistent')).toBeUndefined();
    });

    it('should return config value when set', () => {
      _setConfig({
        testKey: { key: 'testKey', value: 'testValue', type: 'string' },
      } satisfies Configs);
      expect(getConfig('testKey')).toBe('testValue');
    });

    it('should return correct value for multiple configs', () => {
      _setConfig({
        key1: { key: 'key1', value: 'value1', type: 'string' },
        key2: { key: 'key2', value: 'value2', type: 'string' },
      } satisfies Configs);
      expect(getConfig('key1')).toBe('value1');
      expect(getConfig('key2')).toBe('value2');
    });

    it('should handle different value types', () => {
      _setConfig({
        stringKey: { key: 'stringKey', value: 'string', type: 'string' },
        numberKey: { key: 'numberKey', value: 123, type: 'number' },
        booleanKey: { key: 'booleanKey', value: true, type: 'boolean' },
      } satisfies Configs);
      expect(getConfig('stringKey')).toBe('string');
      expect(getConfig('numberKey')).toBe(123);
      expect(getConfig('booleanKey')).toBe(true);
    });
  });

  describe('_setConfig', () => {
    it('should set config and make it retrievable', () => {
      const configs = {
        testKey: { key: 'testKey', value: 'testValue', type: 'string' },
      } satisfies Configs;
      _setConfig(configs);
      expect(getConfig('testKey')).toBe('testValue');
    });

    it('should overwrite previous config', () => {
      _setConfig({
        key1: { key: 'key1', value: 'value1', type: 'string' },
      } satisfies Configs);
      expect(getConfig('key1')).toBe('value1');

      _setConfig({
        key1: { key: 'key1', value: 'updatedValue', type: 'string' },
      } satisfies Configs);
      expect(getConfig('key1')).toBe('updatedValue');
    });

    it('should clear previous configs when setting new ones', () => {
      _setConfig({
        key1: { key: 'key1', value: 'value1', type: 'string' },
        key2: { key: 'key2', value: 'value2', type: 'string' },
      } satisfies Configs);

      _setConfig({
        key3: { key: 'key3', value: 'value3', type: 'string' },
      } satisfies Configs);

      expect(getConfig('key1')).toBeUndefined();
      expect(getConfig('key2')).toBeUndefined();
      expect(getConfig('key3')).toBe('value3');
    });
  });
});
