export function getResponseTypeMap(result: any) {
  if (result instanceof Date) {
    return { type: 'date' };
  }

  if (Array.isArray(result)) {
    const elements: Record<string, any> = {};
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      const subTypeMap = getResponseTypeMap(item);
      if (subTypeMap) {
        elements[i] = subTypeMap;
      }
    }
    return Object.keys(elements).length > 0 ? {
      type: 'array',
      elements
    } : null;
  }

  if (typeof result === 'object' && result !== null) {
    const props: Record<string, any> = {};
    for (const [key, value] of Object.entries(result)) {
      const subTypeMap = getResponseTypeMap(value);
      if (subTypeMap) {
        props[key] = subTypeMap;
      }
    }
    return Object.keys(props).length > 0 ? {
      type: 'object',
      props
    } : null;
  }

  return null;
}

export function reviveResponseTypes<T = any>(data: any, typeMap?: Record<string, any>): T {
  if (!typeMap) {
    return data;
  }

  if (typeMap.type === 'date') {
    return new Date(data) as T;
  }

  if (typeMap.type === 'array') {
    return data.map((item: any, index: number) => reviveResponseTypes(item, typeMap.elements[index]));
  }

  if (typeMap.type === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, reviveResponseTypes(value, typeMap.props[key])])) as T;
  }

  return data;
}
