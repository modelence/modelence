import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { ModelSchema } from './types';

type ObjectTypeDefinition = {
  [key: string]: z.ZodType | ObjectTypeDefinition | Array<z.ZodType | ObjectTypeDefinition>;
};

/**
 * Converts a ModelSchema field definition to a Zod schema
 */
function convertToZodSchema(
  definition: z.ZodType | ObjectTypeDefinition | Array<z.ZodType | ObjectTypeDefinition>
): z.ZodType {
  // If it's already a Zod type
  if (typeof definition === 'object' && definition !== null && '_def' in definition) {
    return definition as z.ZodType;
  }

  // If it's an array
  if (Array.isArray(definition)) {
    const elementSchemas = definition.map((item) => convertToZodSchema(item));
    if (elementSchemas.length === 1) {
      return z.array(elementSchemas[0]);
    }
    return z.array(z.union(elementSchemas as [z.ZodType, z.ZodType, ...z.ZodType[]]));
  }

  // If it's a nested object definition
  if (typeof definition === 'object') {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(definition as ObjectTypeDefinition)) {
      shape[key] = convertToZodSchema(value);
    }
    return z.object(shape);
  }

  throw new Error(`Unsupported schema definition type: ${typeof definition}`);
}

/**
 * Creates a Zod object schema from a ModelSchema
 */
export function createZodValidator(schema: ModelSchema): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const [key, value] of Object.entries(schema)) {
    shape[key] = convertToZodSchema(value);
  }

  return z.object(shape).passthrough();
}

/**
 * Validates a single document for insert operations
 * @throws {z.ZodError} if validation fails
 */
export function validateInsert(
  validator: z.ZodObject<Record<string, z.ZodType>>,
  document: unknown
): void {
  validator.parse(document);
}

/**
 * Validates multiple documents for insert operations
 * @throws {Error} if any validation fails, with index information
 */
export function validateInsertMany(
  validator: z.ZodObject<Record<string, z.ZodType>>,
  documents: unknown[]
): void {
  documents.forEach((doc, index) => {
    try {
      validator.parse(doc);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation failed for document at index ${index}: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      throw error;
    }
  });
}

/**
 * Recursively extracts field-value pairs from a MongoDB update object
 * @param obj - The object to extract from
 * @param path - Current field path (for nested objects)
 * @returns Map of field paths to their values
 */
function extractFieldValues(obj: Record<string, unknown>, path = ''): Map<string, unknown> {
  const fields = new Map<string, unknown>();

  for (const [key, value] of Object.entries(obj)) {
    // Skip MongoDB operator keys that don't contain field values
    if (key.startsWith('$')) {
      continue;
    }

    const fullPath = path ? `${path}.${key}` : key;

    // If value is a plain object (not array, not null, not Date, etc.), recurse
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof ObjectId) &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      // Recursively extract nested fields
      const nested = extractFieldValues(value as Record<string, unknown>, fullPath);
      nested.forEach((v, k) => fields.set(k, v));
    } else {
      // Leaf value
      fields.set(fullPath, value);
    }
  }

  return fields;
}

/**
 * Extracts array items from operators like $push and $addToSet
 */
function extractArrayItems(operatorValue: Record<string, unknown>): Array<{ field: string; value: unknown }> {
  const items: Array<{ field: string; value: unknown }> = [];

  for (const [field, value] of Object.entries(operatorValue)) {
    // Handle $each modifier: { $push: { tags: { $each: ["a", "b"] } } }
    if (value && typeof value === 'object' && '$each' in value) {
      const each = (value as Record<string, unknown>).$each;
      if (Array.isArray(each)) {
        each.forEach((item) => items.push({ field, value: item }));
      }
    } else {
      // Simple case: { $push: { tags: "a" } }
      items.push({ field, value });
    }
  }

  return items;
}

/**
 * Validates a MongoDB update operation against a ModelSchema
 *
 * This validator handles common MongoDB operators intelligently:
 * - $set, $setOnInsert, $min, $max: Validates field values
 * - $push, $addToSet: Validates array items against element schema
 * - $inc, $mul: Validates that increment/multiplier is a number
 * - $unset, $currentDate, $rename: Skips validation (safe operations)
 * - Any other operator: Attempts generic validation
 *
 * @throws {Error} if validation fails
 */
export function validateUpdate(
  validator: z.ZodObject<Record<string, z.ZodType>>,
  update: Record<string, unknown>
): void {
  // Check if this is a direct replacement (no operators)
  const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));

  if (!hasOperators) {
    // Direct replacement - validate entire document with partial schema
    try {
      validator.partial().parse(update);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Update validation failed: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      throw error;
    }
    return;
  }

  const shape = validator.shape;
  const fieldsToValidate: Record<string, unknown> = {};

  // Process each operator
  for (const [operator, operatorValue] of Object.entries(update)) {
    if (!operator.startsWith('$') || typeof operatorValue !== 'object' || !operatorValue) {
      continue;
    }

    // Skip operators that don't need validation
    if (operator === '$unset' || operator === '$currentDate' || operator === '$rename') {
      continue;
    }

    // Handle array operations that need element-level validation
    if (operator === '$push' || operator === '$addToSet' || operator === '$pull' || operator === '$pullAll') {
      const items = extractArrayItems(operatorValue as Record<string, unknown>);

      for (const { field, value } of items) {
        const fieldSchema = shape[field];
        if (fieldSchema && fieldSchema instanceof z.ZodArray) {
          try {
            fieldSchema.element.parse(value);
          } catch (error) {
            if (error instanceof z.ZodError) {
              throw new Error(
                `Update validation failed for array field "${field}": ${error.errors.map((e) => e.message).join(', ')}`
              );
            }
            throw error;
          }
        }
      }
      continue;
    }

    // Handle numeric operations
    if (operator === '$inc' || operator === '$mul') {
      for (const [field, value] of Object.entries(operatorValue as Record<string, unknown>)) {
        if (typeof value !== 'number') {
          throw new Error(`Update validation failed: ${field} value must be a number for ${operator}`);
        }

        const fieldSchema = shape[field];
        if (fieldSchema) {
          // Check that the field itself is a number type
          let numSchema = fieldSchema;
          if (fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodNullable) {
            numSchema = (fieldSchema as z.ZodOptional<z.ZodNumber>)._def.innerType;
          }
          if (!(numSchema instanceof z.ZodNumber)) {
            throw new Error(`Update validation failed: ${field} is not a number field`);
          }
        }
      }
      continue;
    }

    // For other operators ($set, $setOnInsert, $min, $max, etc.), validate field values
    const fields = extractFieldValues(operatorValue as Record<string, unknown>);
    fields.forEach((value, fieldPath) => {
      fieldsToValidate[fieldPath] = value;
    });
  }

  // Validate all extracted fields
  if (Object.keys(fieldsToValidate).length > 0) {
    try {
      validator.partial().parse(fieldsToValidate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Update validation failed: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      throw error;
    }
  }
}
