function isObjectId(value: unknown): value is { toHexString(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toHexString' in value &&
    typeof (value as Record<string, unknown>).toHexString === 'function'
  );
}

/**
 * Recursively converts all MongoDB ObjectId instances to hex strings.
 * Uses duck typing (checks for toHexString method) to avoid importing mongodb on the client.
 * Returns the original input reference unchanged when no ObjectId is present (no allocation).
 */
export function sanitizeResult(result: unknown): unknown {
  if (result == null || typeof result !== 'object') {
    return result;
  }

  if (isObjectId(result)) {
    return result.toHexString();
  }

  if (result instanceof Date) {
    return result;
  }

  if (Array.isArray(result)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      // Primitives and null can never contain an ObjectId — skip recursion.
      if (item === null || typeof item !== 'object') {
        if (out !== null) out.push(item);
        continue;
      }
      const sanitized = sanitizeResult(item);
      if (sanitized !== item) {
        if (out === null) {
          // Copy-on-first-write: preserve all preceding elements.
          out = result.slice(0, i);
        }
        out.push(sanitized);
      } else if (out !== null) {
        out.push(item);
      }
    }
    return out !== null ? out : result;
  }

  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') {
      if (out !== null) out[key] = value;
      continue;
    }
    const sanitized = sanitizeResult(value);
    if (sanitized !== value) {
      if (out === null) {
        out = { ...(result as Record<string, unknown>) };
      }
      out[key] = sanitized;
    }
  }
  return out !== null ? out : result;
}

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
