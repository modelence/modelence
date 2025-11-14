import { describe, expect, test } from '@jest/globals';
import { z } from 'zod';
import { serializeModelSchema } from './schemaSerializer';

describe('data/schemaSerializer', () => {
  describe('serializeModelSchema - primitive types', () => {
    test('serializes string schema', () => {
      const schema = {
        name: z.string(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        name: { type: 'string' },
      });
    });

    test('serializes number schema', () => {
      const schema = {
        age: z.number(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        age: { type: 'number' },
      });
    });

    test('serializes boolean schema', () => {
      const schema = {
        isActive: z.boolean(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        isActive: { type: 'boolean' },
      });
    });

    test('serializes date schema', () => {
      const schema = {
        createdAt: z.date(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        createdAt: { type: 'date' },
      });
    });

    test('serializes multiple primitive types', () => {
      const schema = {
        name: z.string(),
        age: z.number(),
        isActive: z.boolean(),
        createdAt: z.date(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        name: { type: 'string' },
        age: { type: 'number' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'date' },
      });
    });
  });

  describe('serializeModelSchema - array types', () => {
    test('serializes array of strings', () => {
      const schema = {
        tags: z.array(z.string()),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      });
    });

    test('serializes array of numbers', () => {
      const schema = {
        scores: z.array(z.number()),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        scores: {
          type: 'array',
          items: { type: 'number' },
        },
      });
    });

    test('serializes array of objects', () => {
      const schema = {
        items: z.array(
          z.object({
            id: z.string(),
            value: z.number(),
          })
        ),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        items: {
          type: 'array',
          items: {
            type: 'object',
            items: {
              id: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      });
    });

    test('serializes nested arrays', () => {
      const schema = {
        matrix: z.array(z.array(z.number())),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        matrix: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
          },
        },
      });
    });
  });

  describe('serializeModelSchema - object types', () => {
    test('serializes simple object schema', () => {
      const schema = {
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        user: {
          type: 'object',
          items: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      });
    });

    test('serializes nested objects', () => {
      const schema = {
        user: z.object({
          name: z.string(),
          address: z.object({
            street: z.string(),
            city: z.string(),
          }),
        }),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        user: {
          type: 'object',
          items: {
            name: { type: 'string' },
            address: {
              type: 'object',
              items: {
                street: { type: 'string' },
                city: { type: 'string' },
              },
            },
          },
        },
      });
    });

    test('serializes object with mixed types', () => {
      const schema = {
        data: z.object({
          id: z.string(),
          count: z.number(),
          enabled: z.boolean(),
          timestamp: z.date(),
        }),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        data: {
          type: 'object',
          items: {
            id: { type: 'string' },
            count: { type: 'number' },
            enabled: { type: 'boolean' },
            timestamp: { type: 'date' },
          },
        },
      });
    });
  });

  describe('serializeModelSchema - enum types', () => {
    test('serializes enum schema', () => {
      const schema = {
        status: z.enum(['active', 'inactive', 'pending']),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        status: {
          type: 'enum',
          items: ['active', 'inactive', 'pending'],
        },
      });
    });

    test('serializes multiple enums', () => {
      const schema = {
        status: z.enum(['active', 'inactive']),
        role: z.enum(['admin', 'user', 'guest']),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        status: {
          type: 'enum',
          items: ['active', 'inactive'],
        },
        role: {
          type: 'enum',
          items: ['admin', 'user', 'guest'],
        },
      });
    });
  });

  describe('serializeModelSchema - union types', () => {
    test('serializes union of primitives', () => {
      const schema = {
        value: z.union([z.string(), z.number()]),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        value: {
          type: 'union',
          items: [{ type: 'string' }, { type: 'number' }],
        },
      });
    });

    test('serializes union with multiple types', () => {
      const schema = {
        data: z.union([z.string(), z.number(), z.boolean()]),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        data: {
          type: 'union',
          items: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        },
      });
    });

    test('serializes union with complex types', () => {
      const schema = {
        value: z.union([z.object({ type: z.string() }), z.array(z.number())]),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        value: {
          type: 'union',
          items: [
            {
              type: 'object',
              items: {
                type: { type: 'string' },
              },
            },
            {
              type: 'array',
              items: { type: 'number' },
            },
          ],
        },
      });
    });
  });

  describe('serializeModelSchema - optional fields', () => {
    test('serializes optional string', () => {
      const schema = {
        nickname: z.string().optional(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        nickname: {
          type: 'string',
          optional: true,
        },
      });
    });

    test('serializes optional number', () => {
      const schema = {
        age: z.number().optional(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        age: {
          type: 'number',
          optional: true,
        },
      });
    });

    test('serializes optional object', () => {
      const schema = {
        metadata: z
          .object({
            key: z.string(),
          })
          .optional(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        metadata: {
          type: 'object',
          items: {
            key: { type: 'string' },
          },
          optional: true,
        },
      });
    });

    test('serializes optional array', () => {
      const schema = {
        tags: z.array(z.string()).optional(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        tags: {
          type: 'array',
          items: { type: 'string' },
          optional: true,
        },
      });
    });
  });

  describe('serializeModelSchema - nullable fields', () => {
    test('serializes nullable string', () => {
      const schema = {
        middleName: z.string().nullable(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        middleName: {
          type: 'string',
          optional: true,
        },
      });
    });

    test('serializes nullable number', () => {
      const schema = {
        score: z.number().nullable(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        score: {
          type: 'number',
          optional: true,
        },
      });
    });

    test('serializes nullable object', () => {
      const schema = {
        config: z
          .object({
            value: z.string(),
          })
          .nullable(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        config: {
          type: 'object',
          items: {
            value: { type: 'string' },
          },
          optional: true,
        },
      });
    });
  });

  describe('serializeModelSchema - custom types and effects', () => {
    test('serializes effects without description', () => {
      const schema = {
        refinedField: z.string().refine((val) => val.length > 0),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        refinedField: {
          type: 'string',
        },
      });
    });

    test('serializes transform effects', () => {
      const schema = {
        transformed: z.string().transform((val) => val.toUpperCase()),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        transformed: {
          type: 'string',
        },
      });
    });

    test('serializes custom type with unknown typeName', () => {
      // Create a custom zod type with a custom typeName
      const customSchema = z.string();
      // Modify the _def to have a custom typeName
      (customSchema._def as { typeName: string }).typeName = 'ZodCustomType';

      const schema = {
        customField: customSchema,
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        customField: {
          type: 'custom',
          typeName: 'ZodCustomType',
        },
      });
    });
  });

  describe('serializeModelSchema - complex schemas', () => {
    test('serializes complex user schema', () => {
      const schema = {
        id: z.string(),
        username: z.string(),
        email: z.string(),
        age: z.number().optional(),
        roles: z.array(z.string()),
        status: z.enum(['active', 'inactive', 'suspended']),
        profile: z.object({
          firstName: z.string(),
          lastName: z.string(),
          bio: z.string().optional(),
        }),
        createdAt: z.date(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        id: { type: 'string' },
        username: { type: 'string' },
        email: { type: 'string' },
        age: { type: 'number', optional: true },
        roles: {
          type: 'array',
          items: { type: 'string' },
        },
        status: {
          type: 'enum',
          items: ['active', 'inactive', 'suspended'],
        },
        profile: {
          type: 'object',
          items: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            bio: { type: 'string', optional: true },
          },
        },
        createdAt: { type: 'date' },
      });
    });

    test('serializes deeply nested schema', () => {
      const schema = {
        company: z.object({
          name: z.string(),
          departments: z.array(
            z.object({
              name: z.string(),
              employees: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                })
              ),
            })
          ),
        }),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        company: {
          type: 'object',
          items: {
            name: { type: 'string' },
            departments: {
              type: 'array',
              items: {
                type: 'object',
                items: {
                  name: { type: 'string' },
                  employees: {
                    type: 'array',
                    items: {
                      type: 'object',
                      items: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    test('serializes schema with all feature combinations', () => {
      const schema = {
        // Primitives
        name: z.string(),
        count: z.number(),
        enabled: z.boolean(),
        timestamp: z.date(),
        // Optional
        optional: z.string().optional(),
        // Nullable
        nullable: z.string().nullable(),
        // Array
        tags: z.array(z.string()),
        // Object
        metadata: z.object({
          key: z.string(),
          value: z.number(),
        }),
        // Enum
        status: z.enum(['active', 'inactive']),
        // Union
        mixed: z.union([z.string(), z.number()]),
        // Nested
        nested: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              active: z.boolean().optional(),
            })
          ),
        }),
      };

      const result = serializeModelSchema(schema);

      expect(result.name).toEqual({ type: 'string' });
      expect(result.count).toEqual({ type: 'number' });
      expect(result.enabled).toEqual({ type: 'boolean' });
      expect(result.timestamp).toEqual({ type: 'date' });
      expect(result.optional).toEqual({ type: 'string', optional: true });
      expect(result.nullable).toEqual({ type: 'string', optional: true });
      expect(result.tags).toEqual({ type: 'array', items: { type: 'string' } });
      expect(result.metadata).toEqual({
        type: 'object',
        items: {
          key: { type: 'string' },
          value: { type: 'number' },
        },
      });
      expect(result.status).toEqual({ type: 'enum', items: ['active', 'inactive'] });
      expect(result.mixed).toEqual({
        type: 'union',
        items: [{ type: 'string' }, { type: 'number' }],
      });
    });
  });

  describe('serializeModelSchema - edge cases', () => {
    test('serializes empty schema', () => {
      const schema = {};

      const result = serializeModelSchema(schema);

      expect(result).toEqual({});
    });

    test('serializes schema with single field', () => {
      const schema = {
        id: z.string(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        id: { type: 'string' },
      });
    });

    test('handles optional on optional (should flatten)', () => {
      const schema = {
        field: z.string().optional().optional(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        field: { type: 'string', optional: true },
      });
    });

    test('handles nullable on nullable (should flatten)', () => {
      const schema = {
        field: z.string().nullable().nullable(),
      };

      const result = serializeModelSchema(schema);

      expect(result).toEqual({
        field: { type: 'string', optional: true },
      });
    });
  });

  describe('serializeModelSchema - type preservation', () => {
    test('preserves field order', () => {
      const schema = {
        z_last: z.string(),
        a_first: z.string(),
        m_middle: z.string(),
      };

      const result = serializeModelSchema(schema);
      const keys = Object.keys(result);

      expect(keys).toEqual(['z_last', 'a_first', 'm_middle']);
    });

    test('handles special characters in field names', () => {
      const schema = {
        'field-name': z.string(),
        field_name: z.number(),
        'field.name': z.boolean(),
      };

      const result = serializeModelSchema(schema);

      expect(result['field-name']).toEqual({ type: 'string' });
      expect(result['field_name']).toEqual({ type: 'number' });
      expect(result['field.name']).toEqual({ type: 'boolean' });
    });
  });
});
