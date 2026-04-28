import { ObjectId } from 'mongodb';
import { getResponseTypeMap, reviveResponseTypes, sanitizeResult } from './serialize';

describe('serialize', () => {
  describe('sanitizeResult', () => {
    test('should convert ObjectId to hex string', () => {
      const id = new ObjectId('507f1f77bcf86cd799439011');
      expect(sanitizeResult(id)).toBe('507f1f77bcf86cd799439011');
    });

    test('should convert ObjectId fields in objects', () => {
      const id = new ObjectId('507f1f77bcf86cd799439011');
      const result = sanitizeResult({ _id: id, name: 'test' });
      expect(result).toEqual({ _id: '507f1f77bcf86cd799439011', name: 'test' });
    });

    test('should convert nested ObjectId fields', () => {
      const id = new ObjectId('507f1f77bcf86cd799439011');
      const refId = new ObjectId('607f1f77bcf86cd799439022');
      const result = sanitizeResult({
        _id: id,
        author: { userId: refId, name: 'Alice' },
      });
      expect(result).toEqual({
        _id: '507f1f77bcf86cd799439011',
        author: { userId: '607f1f77bcf86cd799439022', name: 'Alice' },
      });
    });

    test('should convert ObjectIds in arrays', () => {
      const id1 = new ObjectId('507f1f77bcf86cd799439011');
      const id2 = new ObjectId('607f1f77bcf86cd799439022');
      const result = sanitizeResult([{ _id: id1 }, { _id: id2 }]);
      expect(result).toEqual([
        { _id: '507f1f77bcf86cd799439011' },
        { _id: '607f1f77bcf86cd799439022' },
      ]);
    });

    test('should preserve Date instances', () => {
      const date = new Date('2024-01-01');
      const result = sanitizeResult({ createdAt: date, name: 'test' });
      expect(result).toEqual({ createdAt: date, name: 'test' });
      expect((result as Record<string, unknown>).createdAt).toBeInstanceOf(Date);
    });

    test('should pass through primitives unchanged', () => {
      expect(sanitizeResult('hello')).toBe('hello');
      expect(sanitizeResult(42)).toBe(42);
      expect(sanitizeResult(true)).toBe(true);
      expect(sanitizeResult(null)).toBeNull();
      expect(sanitizeResult(undefined)).toBeUndefined();
    });

    test('should return the same array reference when no ObjectId is present', () => {
      const arr = [1, 'two', true, null];
      expect(sanitizeResult(arr)).toBe(arr);
    });

    test('should return the same object reference when no ObjectId is present', () => {
      const obj = { name: 'Alice', count: 3 };
      expect(sanitizeResult(obj)).toBe(obj);
    });

    test('should return the same nested object reference when no ObjectId is present', () => {
      const inner = { x: 1 };
      const outer = { inner, label: 'test' };
      const result = sanitizeResult(outer) as typeof outer;
      expect(result).toBe(outer);
      expect(result.inner).toBe(inner);
    });

    test('should return the same array reference for array of plain objects with no ObjectId', () => {
      const arr = [{ a: 1 }, { b: 'two' }];
      expect(sanitizeResult(arr)).toBe(arr);
    });

    test('should only replace the element containing the ObjectId (copy-on-write)', () => {
      const id = new ObjectId('507f1f77bcf86cd799439011');
      const unchanged = { name: 'Bob' };
      const arr = [unchanged, { _id: id }];
      const result = sanitizeResult(arr) as unknown[];
      expect(result).not.toBe(arr);
      expect(result[0]).toBe(unchanged);
      expect((result[1] as Record<string, unknown>)._id).toBe('507f1f77bcf86cd799439011');
    });

    test('should only replace the changed key on an object (copy-on-write)', () => {
      const id = new ObjectId('507f1f77bcf86cd799439011');
      const nested = { ref: id };
      const obj = { a: 1, nested };
      const result = sanitizeResult(obj) as typeof obj;
      expect(result).not.toBe(obj);
      expect((result as Record<string, unknown>).a).toBe(1);
      expect((result.nested as Record<string, unknown>).ref).toBe('507f1f77bcf86cd799439011');
    });

    test('should return the same Date reference inside an object with no ObjectId', () => {
      const date = new Date('2024-06-01');
      const obj = { createdAt: date };
      const result = sanitizeResult(obj) as typeof obj;
      expect(result).toBe(obj);
      expect(result.createdAt).toBe(date);
    });
  });

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
