import { Document } from 'mongodb';
import { z } from 'zod';

type ZodDefWithTypeName = {
  typeName: string;
};

type ZodWrapperDef = ZodDefWithTypeName & {
  innerType?: z.ZodType;
  schema?: z.ZodType;
  type?: z.ZodType;
  out?: z.ZodType;
};

type ZodDefaultDef = ZodWrapperDef & {
  defaultValue: () => unknown;
};

type ZodObjectDef = ZodDefWithTypeName & {
  shape: () => Record<string, z.ZodType>;
};

type ZodArrayDef = ZodDefWithTypeName & {
  type: z.ZodType;
};

const isDocumentRecord = (value: unknown): value is Document =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodType = (value: unknown): value is z.ZodType =>
  isDocumentRecord(value) && '_def' in value;

const getZodDef = (zodType: z.ZodType): ZodDefWithTypeName => zodType._def as ZodDefWithTypeName;

const getWrappedZodType = (zodType: z.ZodType): z.ZodType | undefined => {
  const def = getZodDef(zodType) as ZodWrapperDef;

  if (
    def.typeName === 'ZodOptional' ||
    def.typeName === 'ZodNullable' ||
    def.typeName === 'ZodDefault' ||
    def.typeName === 'ZodCatch' ||
    def.typeName === 'ZodReadonly'
  ) {
    return def.innerType;
  }

  if (def.typeName === 'ZodEffects') {
    return def.schema;
  }

  if (def.typeName === 'ZodBranded') {
    return def.type;
  }

  if (def.typeName === 'ZodPipeline') {
    return def.out;
  }

  return undefined;
};

const getZodDefaultValue = (zodType: z.ZodType): { hasDefault: boolean; value?: unknown } => {
  const def = getZodDef(zodType);

  if (def.typeName === 'ZodDefault') {
    return {
      hasDefault: true,
      value: (def as ZodDefaultDef).defaultValue(),
    };
  }

  const wrappedType = getWrappedZodType(zodType);
  if (wrappedType) {
    return getZodDefaultValue(wrappedType);
  }

  return { hasDefault: false };
};

const applyDefaultsToZodValue = (zodType: z.ZodType, value: unknown): unknown => {
  const def = getZodDef(zodType);

  if (def.typeName === 'ZodObject' && isDocumentRecord(value)) {
    return applyDefaultsToModelSchema((def as ZodObjectDef).shape(), value);
  }

  if (def.typeName === 'ZodArray' && Array.isArray(value)) {
    return value.map((item) => applyDefaultsToZodValue((def as ZodArrayDef).type, item));
  }

  const wrappedType = getWrappedZodType(zodType);
  if (wrappedType) {
    return applyDefaultsToZodValue(wrappedType, value);
  }

  return value;
};

const applyDefaultsToSchemaDefinition = (schemaDefinition: unknown, value: unknown): unknown => {
  if (isZodType(schemaDefinition)) {
    return applyDefaultsToZodValue(schemaDefinition, value);
  }

  if (Array.isArray(schemaDefinition) && Array.isArray(value)) {
    if (schemaDefinition.length === 1) {
      return value.map((item) => applyDefaultsToSchemaDefinition(schemaDefinition[0], item));
    }

    return value.map((item, index) =>
      applyDefaultsToSchemaDefinition(schemaDefinition[index], item)
    );
  }

  if (isDocumentRecord(schemaDefinition) && isDocumentRecord(value)) {
    return applyDefaultsToModelSchema(schemaDefinition, value);
  }

  return value;
};

export const applyDefaultsToModelSchema = (
  schema: Record<string, unknown>,
  document: Document
): Document => {
  const result: Document = { ...document };

  for (const [key, schemaDefinition] of Object.entries(schema)) {
    const currentValue = result[key];

    if (currentValue === undefined) {
      if (isZodType(schemaDefinition)) {
        const defaultValue = getZodDefaultValue(schemaDefinition);
        if (defaultValue.hasDefault) {
          result[key] = applyDefaultsToSchemaDefinition(schemaDefinition, defaultValue.value);
        }
      }
      continue;
    }

    result[key] = applyDefaultsToSchemaDefinition(schemaDefinition, currentValue);
  }

  return result;
};
