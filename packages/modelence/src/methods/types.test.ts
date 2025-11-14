import type { Method, MethodDefinition, MethodType } from './types';

type MethodTypesAggregate = Method | MethodDefinition | MethodType;

describe('methods/types', () => {
  test('should have valid Method type', () => {
    // Type-only test to ensure types compile
    const typeCheck: MethodTypesAggregate | null = null;
    expect(typeCheck).toBeNull();
  });
});
