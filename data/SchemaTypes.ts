export const SchemaTypes = {
  String: 'string',
  Date: 'date',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'array'
} as const;

export type SchemaType = typeof SchemaTypes[keyof typeof SchemaTypes];
