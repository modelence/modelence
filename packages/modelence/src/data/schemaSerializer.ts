import { z } from 'zod';
import { ModelSchema } from './types';

type ObjectTypeDefinition = {
  [key: string]: z.ZodType | ObjectTypeDefinition | Array<z.ZodType | ObjectTypeDefinition>;
};

export interface SerializedModelSchema {
  [key: string]: SerializedSchema | (SerializedSchema | SerializedModelSchema)[] | SerializedModelSchema;
}

// Type guards for Zod schema types
type ZodDefWithTypeName = {
  typeName: z.ZodFirstPartyTypeKind;
};

type ZodArrayDef = ZodDefWithTypeName & {
  type: z.ZodType;
};

type ZodObjectDef = ZodDefWithTypeName & {
  shape: () => Record<string, z.ZodType>;
};

type ZodOptionalDef = ZodDefWithTypeName & {
  innerType: z.ZodType;
};

type ZodEnumDef = ZodDefWithTypeName & {
  values: readonly [string, ...string[]];
};

type ZodUnionDef = ZodDefWithTypeName & {
  options: readonly [z.ZodType, z.ZodType, ...z.ZodType[]];
};

type BaseSerializedSchema =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'date' }
  | { type: 'array'; items: SerializedSchema }
  | { type: 'object'; shape: Record<string, SerializedSchema> }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'union'; options: SerializedSchema[] }
  | { type: 'unknown'; typeName: string };

type SerializedSchema = BaseSerializedSchema | (BaseSerializedSchema & { optional: true });

/**
 * Serializes a Zod schema to a JSON-serializable format
 */
function serializeZodSchema(zodType: z.ZodType): SerializedSchema {
  const def = zodType._def as ZodDefWithTypeName;

  if (def.typeName === 'ZodString') {
    return { type: 'string' };
  }
  if (def.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  if (def.typeName === 'ZodDate') {
    return { type: 'date' };
  }
  if (def.typeName === 'ZodArray') {
    const arrayDef = def as ZodArrayDef;
    return {
      type: 'array',
      items: serializeZodSchema(arrayDef.type),
    };
  }
  if (def.typeName === 'ZodObject') {
    const objectDef = def as ZodObjectDef;
    const shape = objectDef.shape();
    const serializedShape: Record<string, any> = {};
    for (const [key, value] of Object.entries(shape)) {
      serializedShape[key] = serializeZodSchema(value as z.ZodType);
    }
    return {
      type: 'object',
      shape: serializedShape,
    };
  }
  if (def.typeName === 'ZodOptional') {
    const optionalDef = def as ZodOptionalDef;
    return {
      ...serializeZodSchema(optionalDef.innerType),
      optional: true,
    };
  }
  if (def.typeName === 'ZodEnum') {
    const enumDef = def as ZodEnumDef;
    return {
      type: 'enum',
      values: enumDef.values,
    };
  }
  if (def.typeName === 'ZodUnion') {
    const unionDef = def as ZodUnionDef;
    return {
      type: 'union',
      options: unionDef.options.map(serializeZodSchema),
    };
  }

  // For custom types like ObjectId, ref, etc.
  return { type: 'unknown', typeName: def.typeName };
}

/**
 * Serializes a model schema to a JSON-serializable format
 */
export function serializeModelSchema(schema: ModelSchema): SerializedModelSchema {
  const serialized: SerializedModelSchema = {};

  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value)) {
      // Handle array of schema definitions
      serialized[key] = value.map((item) => {
        if (typeof item === 'object' && '_def' in item) {
          return serializeZodSchema(item as z.ZodType);
        }
        return serializeModelSchema(item as ObjectTypeDefinition);
      });
    } else if (typeof value === 'object' && '_def' in value) {
      // It's a Zod type
      serialized[key] = serializeZodSchema(value as z.ZodType);
    } else {
      // It's a nested object definition
      serialized[key] = serializeModelSchema(value as ObjectTypeDefinition);
    }
  }

  return serialized;
}
