export function getResponseTypeMap(result: unknown) {
  if (result instanceof Date) {
    return { type: 'date' };
  }

  if (Array.isArray(result)) {
    const elements: Record<string, unknown> = {};
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      const subTypeMap = getResponseTypeMap(item);
      if (subTypeMap) {
        elements[i] = subTypeMap;
      }
    }
    return Object.keys(elements).length > 0
      ? {
          type: 'array',
          elements,
        }
      : null;
  }

  if (typeof result === 'object' && result !== null) {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      const subTypeMap = getResponseTypeMap(value);
      if (subTypeMap) {
        props[key] = subTypeMap;
      }
    }
    return Object.keys(props).length > 0
      ? {
          type: 'object',
          props,
        }
      : null;
  }

  return null;
}

export function reviveResponseTypes<T = unknown>(data: T, typeMap?: Record<string, unknown>): T {
  if (!typeMap) {
    return data;
  }

  if (typeMap.type === 'date') {
    return new Date(data as string) as T;
  }

  if (typeMap.type === 'array') {
    return (data as unknown[]).map((item: unknown, index: number) =>
      reviveResponseTypes(item, (typeMap.elements as Record<string, unknown>[])[index])
    ) as T;
  }

  if (typeMap.type === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        reviveResponseTypes(
          value,
          (typeMap.props as Record<string, unknown>)[key] as Record<string, unknown>
        ),
      ])
    ) as T;
  }

  return data;
}
