import { usersCollection } from './db';
import { validateHandle, MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH } from './validators';

/**
Finds an available handle by appending incremental suffixes (_2, _3, …)
to the base handle until a unique one is found.
The base handle is truncated so that the suffixed candidate never exceeds MAX_HANDLE_LENGTH.
 */
async function findAvailableHandle(baseHandle: string): Promise<string> {
  // Truncate base handle to MAX_HANDLE_LENGTH so the unsuffixed form is valid.
  const truncatedBase = baseHandle.slice(0, MAX_HANDLE_LENGTH);

  const firstCheck = await usersCollection.findOne(
    { handle: truncatedBase },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!firstCheck) {
    return truncatedBase;
  }

  let suffix = 2;
  while (true) {
    const suffixStr = `_${suffix}`;
    // Truncate base so that base + suffix fits within the limit.
    const candidate = `${truncatedBase.slice(0, MAX_HANDLE_LENGTH - suffixStr.length)}${suffixStr}`;
    const conflict = await usersCollection.findOne(
      { handle: candidate },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (!conflict) {
      return candidate;
    }

    suffix++;
  }
}

/**
 * Resolves a unique handle for a new user.
 *
 * If the caller supplied a handle it is validated and checked for uniqueness.
 * - When `throwOnConflict` is true (default), an error is thrown if the handle is taken.
 * - When `throwOnConflict` is false, a numeric suffix (_2, _3, …) is appended to make
 *   it unique. This is intended for system-generated handles (e.g. from `generateHandle`).
 *
 * If no handle is supplied, the local part of the email address is used as the base handle,
 * and a numeric suffix is appended until an unused handle is found.
 */
export async function resolveUniqueHandle(
  rawHandle: string | undefined,
  email: string,
  { throwOnConflict = true }: { throwOnConflict?: boolean } = {}
): Promise<string> {
  if (rawHandle !== undefined && rawHandle !== null && String(rawHandle).trim() !== '') {
    // Caller explicitly provided a handle – trim and validate it.
    const handle = validateHandle(String(rawHandle).trim());

    if (throwOnConflict) {
      const existing = await usersCollection.findOne(
        { handle },
        { collation: { locale: 'en', strength: 2 } }
      );

      if (existing) {
        throw new Error('Handle already taken.');
      }

      return handle;
    }

    // System-generated handle – find an available variant with suffix if needed.
    return findAvailableHandle(handle);
  }

  // Derive handle from the email local-part (everything before '@').
  // Truncate to MAX_HANDLE_LENGTH since RFC 5321 allows local parts up to 64 chars.
  const baseHandle = email.split('@')[0].padEnd(MIN_HANDLE_LENGTH, '_').slice(0, MAX_HANDLE_LENGTH);
  return findAvailableHandle(baseHandle);
}
