import { usersCollection } from './db';
import { validateHandle } from './validators';

/**
Finds an available handle by appending incremental suffixes (_2, _3, …)
to the base handle until a unique one is found.
 */
async function findAvailableHandle(baseHandle: string): Promise<string> {
  const firstCheck = await usersCollection.findOne(
    { handle: baseHandle },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!firstCheck) {
    return baseHandle;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${baseHandle}_${suffix}`;
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
    // Caller explicitly provided a handle – validate it.
    const handle = validateHandle(String(rawHandle));

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
  const baseHandle = email.split('@')[0];
  return findAvailableHandle(baseHandle);
}
