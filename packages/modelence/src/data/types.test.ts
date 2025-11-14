import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { schema } from './types';

describe('data/types', () => {
  describe('schema.string', () => {
    test('should create a string schema', () => {
      const stringSchema = schema.string();
      expect(stringSchema.parse('hello')).toBe('hello');
      expect(() => stringSchema.parse(123)).toThrow();
    });
  });

  describe('schema.number', () => {
    test('should create a number schema', () => {
      const numberSchema = schema.number();
      expect(numberSchema.parse(123)).toBe(123);
      expect(numberSchema.parse(45.67)).toBe(45.67);
      expect(() => numberSchema.parse('not a number')).toThrow();
    });
  });

  describe('schema.boolean', () => {
    test('should create a boolean schema', () => {
      const booleanSchema = schema.boolean();
      expect(booleanSchema.parse(true)).toBe(true);
      expect(booleanSchema.parse(false)).toBe(false);
      expect(() => booleanSchema.parse('true')).toThrow();
    });
  });

  describe('schema.date', () => {
    test('should create a date schema', () => {
      const dateSchema = schema.date();
      const now = new Date();
      const parsed = dateSchema.parse(now);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getTime()).toBe(now.getTime());
      expect(() => dateSchema.parse('2024-01-01')).toThrow();
    });
  });

  describe('schema.array', () => {
    test('should create an array schema', () => {
      const arraySchema = schema.array(z.string());
      expect(arraySchema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
      expect(() => arraySchema.parse([1, 2, 3])).toThrow();
    });
  });

  describe('schema.object', () => {
    test('should create an object schema', () => {
      const objectSchema = schema.object({
        name: z.string(),
        age: z.number(),
      });
      const result = objectSchema.parse({ name: 'John', age: 30 });
      expect(result).toEqual({ name: 'John', age: 30 });
      expect(() => objectSchema.parse({ name: 'John' })).toThrow();
    });
  });

  describe('schema.enum', () => {
    test('should create an enum schema', () => {
      const enumSchema = schema.enum(['red', 'green', 'blue']);
      expect(enumSchema.parse('red')).toBe('red');
      expect(enumSchema.parse('blue')).toBe('blue');
      expect(() => enumSchema.parse('yellow')).toThrow();
    });
  });

  describe('schema.embedding', () => {
    test('should create an embedding (array of numbers) schema', () => {
      const embeddingSchema = schema.embedding();
      expect(embeddingSchema.parse([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
      expect(embeddingSchema.parse([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
      expect(() => embeddingSchema.parse(['a', 'b'])).toThrow();
    });
  });

  describe('schema.objectId', () => {
    test('should create an ObjectId schema', () => {
      const objectIdSchema = schema.objectId();
      const id = new ObjectId();
      expect(objectIdSchema.parse(id)).toBe(id);
      expect(() => objectIdSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have ObjectId description', () => {
      const objectIdSchema = schema.objectId();
      expect(objectIdSchema.description).toBe('ObjectId');
    });
  });

  describe('schema.userId', () => {
    test('should create a userId schema', () => {
      const userIdSchema = schema.userId();
      const id = new ObjectId();
      expect(userIdSchema.parse(id)).toBe(id);
      expect(() => userIdSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have UserId description', () => {
      const userIdSchema = schema.userId();
      expect(userIdSchema.description).toBe('UserId');
    });
  });

  describe('schema.ref', () => {
    test('should create a ref schema with string collection', () => {
      const refSchema = schema.ref('users');
      const id = new ObjectId();
      expect(refSchema.parse(id)).toBe(id);
      expect(() => refSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have Ref description', () => {
      const refSchema = schema.ref('posts');
      expect(refSchema.description).toBe('Ref');
    });
  });

  describe('schema.union', () => {
    test('should create a union schema', () => {
      const unionSchema = schema.union([z.string(), z.number()]);
      expect(unionSchema.parse('hello')).toBe('hello');
      expect(unionSchema.parse(123)).toBe(123);
      expect(() => unionSchema.parse(true)).toThrow();
    });
  });

  describe('schema.infer', () => {
    test('should provide type inference helper', () => {
      const testSchema = {
        name: z.string(),
        age: z.number(),
      };
      const inferred = schema.infer(testSchema);
      expect(inferred).toBeDefined();
      expect(typeof inferred).toBe('object');
    });
  });

  describe('complex schema combinations', () => {
    test('should work with nested schemas', () => {
      const userSchema = schema.object({
        name: schema.string(),
        age: schema.number(),
        email: schema.string().email(),
        tags: schema.array(schema.string()),
      });

      const validUser = {
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        tags: ['developer', 'designer'],
      };

      expect(userSchema.parse(validUser)).toEqual(validUser);
    });

    test('should work with optional fields', () => {
      const profileSchema = schema.object({
        username: schema.string(),
        bio: schema.string().optional(),
      });

      expect(profileSchema.parse({ username: 'bob' })).toEqual({ username: 'bob' });
      expect(profileSchema.parse({ username: 'bob', bio: 'Hello' })).toEqual({
        username: 'bob',
        bio: 'Hello',
      });
    });
  });
});
