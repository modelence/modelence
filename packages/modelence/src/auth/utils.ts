import { randomBytes } from 'crypto';
import { usersCollection } from './db';
import { User } from './types';
import { validateHandle, MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH } from './validators';

export function serializeUserForClient(userDoc: User) {
  return {
    id: userDoc._id,
    handle: userDoc.handle,
    roles: userDoc.roles || [],
    firstName: userDoc.firstName ?? undefined,
    lastName: userDoc.lastName ?? undefined,
    avatarUrl: userDoc.avatarUrl ?? undefined,
  };
}

/**
Finds an available handle by appending incremental suffixes (_2, _3, …)
to the base handle until a unique one is found.
The base handle is truncated so that the suffixed candidate never exceeds MAX_HANDLE_LENGTH.
 */
async function findAvailableHandle(baseHandle: string): Promise<string> {
  // Truncate base handle to MAX_HANDLE_LENGTH so the unsuffixed form is valid.
  const truncatedBase = baseHandle.slice(0, MAX_HANDLE_LENGTH);

  // Check the unsuffixed base handle first.
  try {
    const firstCheck = await usersCollection.findOne(
      { handle: truncatedBase },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (!firstCheck) {
      return truncatedBase;
    }
  } catch (err) {
    throw new Error(`Database error while checking handle availability: ${err}`);
  }

  // Try sequential suffixes _2 through _51 (50 attempts).
  const MAX_SUFFIX_VALUE = 51;

  for (let suffix = 2; suffix <= MAX_SUFFIX_VALUE; suffix++) {
    const suffixStr = `_${suffix}`;
    const candidate = `${truncatedBase.slice(0, MAX_HANDLE_LENGTH - suffixStr.length)}${suffixStr}`;

    try {
      const conflict = await usersCollection.findOne(
        { handle: candidate },
        { collation: { locale: 'en', strength: 2 } }
      );

      if (!conflict) {
        return candidate;
      }
    } catch (err) {
      throw new Error(`Database error while checking handle "${candidate}": ${err}`);
    }
  }

  // Fallback: sequential suffixes exhausted — use random hex suffixes.
  // Limit the number of attempts to avoid an infinite loop in case of persistent DB issues
  const MAX_RANDOM_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt++) {
    const randomSuffix = `_${randomBytes(3).toString('hex')}`;
    const candidate = `${truncatedBase.slice(0, MAX_HANDLE_LENGTH - randomSuffix.length)}${randomSuffix}`;

    try {
      const conflict = await usersCollection.findOne(
        { handle: candidate },
        { collation: { locale: 'en', strength: 2 } }
      );

      if (!conflict) {
        return candidate;
      }
    } catch (err) {
      throw new Error(`Database error while checking handle "${candidate}": ${err}`);
    }
  }

  throw new Error(
    `Could not generate a unique handle for base "${baseHandle}" after exhausting all attempts.`
  );
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
