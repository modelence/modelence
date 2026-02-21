import { usersCollection } from './db';
import { validateHandle } from './validators';

/**
Resolves a unique handle for a new user.
If the caller supplied a handle it is validated and checked for uniqueness.
Otherwise the local part of the email address is used as the base handle, and a numeric suffix (_2, _3, …) is appended until an unused handle is found.
 */
export async function resolveUniqueHandle(
  rawHandle: string | undefined,
  email: string
): Promise<string> {
  if (rawHandle !== undefined && rawHandle !== null && String(rawHandle).trim() !== '') {
    // Caller explicitly provided a handle – validate & ensure uniqueness.
    const handle = validateHandle(String(rawHandle));

    const existing = await usersCollection.findOne(
      { handle },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (existing) {
      throw new Error('Handle already taken.');
    }

    return handle;
  }

  // Derive handle from the email local-part (everything before '@').
  const baseHandle = email.split('@')[0];

  // First attempt: use the base handle as-is.
  const firstCheck = await usersCollection.findOne(
    { handle: baseHandle },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!firstCheck) {
    return baseHandle;
  }

  // Collision detected – try incremental suffixes _2, _3, …
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
