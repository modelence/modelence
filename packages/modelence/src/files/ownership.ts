import { randomBytes } from 'crypto';
import type { FileVisibility } from './types';

/**
 * Builds the canonical, owner-scoped storage path for a newly uploaded file.
 *
 * The caller may supply a human-readable `name` (e.g. `report.pdf`), but it is
 * always stored under a namespace the server controls — `{visibility}/u/{ownerId}/…`
 * — so one user can never pick a path that collides with or overwrites another
 * user's file. A short random segment keeps repeated uploads of the same name
 * distinct while remaining unguessable for private files.
 */
export function buildOwnedFilePath({
  visibility,
  ownerId,
  name,
}: {
  visibility: FileVisibility;
  ownerId: string;
  name?: string;
}): string {
  const random = randomBytes(12).toString('hex');
  const safeName = sanitizeName(name);
  const suffix = safeName ? `${random}-${safeName}` : random;
  return `${visibility}/u/${ownerId}/${suffix}`;
}

/**
 * Normalizes a client-supplied file name into a single safe path segment.
 *
 * Strips any directory components and characters that could be used to escape
 * the owner namespace (`/`, `..`, control chars), so the resulting value can
 * only ever be a leaf name inside `{visibility}/u/{ownerId}/`.
 */
export function sanitizeName(name?: string): string {
  if (!name) {
    return '';
  }
  // Keep only the final segment, then allow a conservative character set.
  const leaf = name.split(/[/\\]/).pop() ?? '';
  const cleaned = leaf.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  // Cap length so a pathological name can't blow up the key.
  return cleaned.slice(0, 128);
}

/**
 * Returns `true` if `filePath` targets the private visibility namespace.
 * Anything not explicitly under `public/` is treated as private, so a malformed
 * or prefix-less path is never mistaken for a world-readable public asset.
 */
export function isPrivatePath(filePath: string): boolean {
  return !filePath.startsWith('public/');
}
