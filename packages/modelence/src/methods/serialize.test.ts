import { getResponseTypeMap, reviveResponseTypes } from './serialize';

describe('serialize', () => {
  describe('getResponseTypeMap', () => {
    test('should detect Date objects', () => {
      const date = new Date('2024-01-01');
      const typeMap = getResponseTypeMap(date);
      expect(typeMap).toEqual({ type: 'date' });
    });

    test('should detect arrays with Date elements', () => {
      const data = [new Date('2024-01-01'), 'string', new Date('2024-01-02')];
      const typeMap = getResponseTypeMap(data);
      expect(typeMap).toEqual({
        type: 'array',
        elements: {
          0: { type: 'date' },
          2: { type: 'date' },
        },
      });
    });

    test('should detect objects with Date properties', () => {
      const data = {
        createdAt: new Date('2024-01-01'),
        name: 'test',
        updatedAt: new Date('2024-01-02'),
      };
      const typeMap = getResponseTypeMap(data);
      expect(typeMap).toEqual({
        type: 'object',
        props: {
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' },
        },
      });
    });

    test('should handle nested objects', () => {
      const data = {
        user: {
          createdAt: new Date('2024-01-01'),
        },
      };
      const typeMap = getResponseTypeMap(data);
      expect(typeMap).toEqual({
        type: 'object',
        props: {
          user: {
            type: 'object',
            props: {
              createdAt: { type: 'date' },
            },
          },
        },
      });
    });

    test('should return null for primitive types', () => {
      expect(getResponseTypeMap('string')).toBeNull();
      expect(getResponseTypeMap(123)).toBeNull();
      expect(getResponseTypeMap(true)).toBeNull();
      expect(getResponseTypeMap(null)).toBeNull();
    });
  });

  describe('reviveResponseTypes', () => {
    test('should revive Date from string', () => {
      const dateString = '2024-01-01T00:00:00.000Z';
      const typeMap = { type: 'date' };
      const result = reviveResponseTypes(dateString, typeMap);
      expect(result).toBeInstanceOf(Date);
      expect(result).toEqual(new Date(dateString));
    });

    test('should revive array with Date elements', () => {
      const data = ['2024-01-01T00:00:00.000Z', 'string', '2024-01-02T00:00:00.000Z'];
      const typeMap = {
        type: 'array',
        elements: {
          0: { type: 'date' },
          2: { type: 'date' },
        },
      };
      const result = reviveResponseTypes(data, typeMap);
      expect(result[0]).toBeInstanceOf(Date);
      expect(result[1]).toBe('string');
      expect(result[2]).toBeInstanceOf(Date);
    });

    test('should revive object with Date properties', () => {
      const data = {
        createdAt: '2024-01-01T00:00:00.000Z',
        name: 'test',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };
      const typeMap = {
        type: 'object',
        props: {
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' },
        },
      };
      const result = reviveResponseTypes(data, typeMap);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.name).toBe('test');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test('should return data unchanged if no typeMap provided', () => {
      const data = { foo: 'bar' };
      const result = reviveResponseTypes(data);
      expect(result).toBe(data);
    });
  });
});
