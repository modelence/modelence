import { getConfig, setSchema, loadConfigs, getPublicConfigs } from './server';

describe('config/server', () => {
  // Note: We don't reset state in beforeEach because the module state
  // persists across tests. Each test should set up its own state.

  describe('getConfig', () => {
    it('should be a function', () => {
      expect(typeof getConfig).toBe('function');
    });

    it('should return undefined for non-existent config', () => {
      expect(getConfig('nonexistent')).toBeUndefined();
    });

    it('should return config value when loaded for system configs', () => {
      loadConfigs([{ key: '_system.testKey', value: 'testValue', type: 'string' }]);
      expect(getConfig('_system.testKey')).toBe('testValue');
    });
  });

  describe('setSchema', () => {
    it('should be a function', () => {
      expect(typeof setSchema).toBe('function');
    });

    it('should accept a valid schema', () => {
      expect(() => {
        setSchema({
          'test.key': {
            type: 'string',
            default: 'default',
            isPublic: true,
          },
        });
      }).not.toThrow();
    });

    it('should throw error for secret config marked as public', () => {
      expect(() => {
        setSchema({
          'test.secret': {
            type: 'secret',
            default: '',
            isPublic: true,
          },
        });
      }).toThrow('Config test.secret with type "secret" cannot be public');
    });

    it('should allow secret config marked as private', () => {
      expect(() => {
        setSchema({
          'test.secret': {
            type: 'secret',
            default: '',
            isPublic: false,
          },
        });
      }).not.toThrow();
    });
  });

  describe('loadConfigs', () => {
    it('should be a function', () => {
      expect(typeof loadConfigs).toBe('function');
    });

    it('should load system configs and make them accessible', () => {
      loadConfigs([
        { key: '_system.key1', value: 'value1', type: 'string' },
        { key: '_system.key2', value: 123, type: 'number' },
      ]);
      expect(getConfig('_system.key1')).toBe('value1');
      expect(getConfig('_system.key2')).toBe(123);
    });

    it('should load system configs without schema', () => {
      loadConfigs([{ key: '_system.test', value: 'systemValue', type: 'string' }]);
      expect(getConfig('_system.test')).toBe('systemValue');
    });

    it('should ignore unknown non-system configs', () => {
      loadConfigs([{ key: 'unknown.key', value: 'value', type: 'string' }]);
      expect(getConfig('unknown.key')).toBeUndefined();
    });

    it('should load configs that match schema', () => {
      setSchema({
        'known.key': {
          type: 'string',
          default: 'default',
          isPublic: true,
        },
      });
      loadConfigs([{ key: 'known.key', value: 'customValue', type: 'string' }]);
      expect(getConfig('known.key')).toBe('customValue');
    });
  });

  describe('getPublicConfigs', () => {
    it('should be a function', () => {
      expect(typeof getPublicConfigs).toBe('function');
    });

    it('should return public configs when schema is set', () => {
      setSchema({
        'test.public': {
          type: 'string',
          default: 'public',
          isPublic: true,
        },
      });
      loadConfigs([]);

      const publicConfigs = getPublicConfigs();
      expect(publicConfigs['test.public']).toBeDefined();
    });

    it('should return public configs after initialization', () => {
      setSchema({
        'public.key': {
          type: 'string',
          default: 'default',
          isPublic: true,
        },
        'private.key': {
          type: 'string',
          default: 'default',
          isPublic: false,
        },
      });
      loadConfigs([]);

      const publicConfigs = getPublicConfigs();
      expect(publicConfigs['public.key']).toBeDefined();
      expect(publicConfigs['private.key']).toBeUndefined();
    });

    it('should use default values for unset configs', () => {
      setSchema({
        'test.key': {
          type: 'string',
          default: 'defaultValue',
          isPublic: true,
        },
      });
      loadConfigs([]);

      const publicConfigs = getPublicConfigs();
      expect(publicConfigs['test.key'].value).toBe('defaultValue');
    });

    it('should use loaded values over defaults', () => {
      setSchema({
        'test.key': {
          type: 'string',
          default: 'defaultValue',
          isPublic: true,
        },
      });
      loadConfigs([{ key: 'test.key', value: 'customValue', type: 'string' }]);

      const publicConfigs = getPublicConfigs();
      expect(publicConfigs['test.key'].value).toBe('customValue');
    });
  });
});
