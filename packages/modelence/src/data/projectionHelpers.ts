/**
 * Determines if a projection value represents an inclusion.
 * Inclusion values: `1`, `true`, or operator objects like `{ $slice: 5 }` / `{ $elemMatch: ... }`.
 * Exclusion values: `0`, `false`.
 */
export function isProjectionInclusionValue(val: unknown): boolean {
  if (val === 1 || val === true) return true;
  if (val === 0 || val === false) return false;
  if (val !== null && typeof val === 'object') return true;
  return false;
}

/**
 * Determines if a value is a container (plain object or array) capable of holding
 * sub-properties that can be traversed.
 *
 * Uses a whitelist: only plain objects (Object.prototype or null-prototype) and arrays.
 * Automatically rejects class instances (Date, RegExp, Buffer, Map, Set, ObjectId, etc.).
 */
export function isContainer(val: unknown): boolean {
  if (val === null || val === undefined || typeof val !== 'object') return false;
  if (Array.isArray(val)) {
    if (val.length === 0) return true;
    return val.some((item) => isContainer(item));
  }

  const ctor = (val as object).constructor;
  return ctor === undefined || ctor === Object;
}

/**
 * Recursively walks a dot-path (e.g. 'players.profile'), stepping through array items,
 * to check if a valid container object/array exists at that path in the document.
 */
export function hasContainerAtPath(obj: unknown, parts: string[], index = 0): boolean {
  if (obj === null || obj === undefined) return false;

  if (Array.isArray(obj)) {
    return obj.some((item) => hasContainerAtPath(item, parts, index));
  }

  if (typeof obj !== 'object') return false;

  const record = obj as Record<string, unknown>;
  const next = record[parts[index]];

  if (index === parts.length - 1) {
    return isContainer(next);
  }

  return hasContainerAtPath(next, parts, index + 1);
}

/**
 * Recursively deletes a dot-path from an object/array in-place.
 * Parent object structures defined in the schema are preserved so consumer code
 * expecting the parent object container does not encounter undefined property access errors.
 */
export function deletePath(obj: unknown, parts: string[], index = 0): void {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deletePath(item, parts, index);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  const key = parts[index];
  if (!(key in record)) return;

  if (index === parts.length - 1) {
    delete record[key];
    return;
  }

  const next = record[key];
  if (!next || typeof next !== 'object') return;

  deletePath(next, parts, index + 1);
}
