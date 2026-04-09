import { z } from 'zod';
import { UpdateProfileProps } from '../methods/types';

export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 50;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Reusable string validators
const trimmedNonEmptyString = (opts: { min?: number; max: number }) =>
  z
    .string()
    .trim()
    .min(opts.min ?? 1, { message: `must be at least ${opts.min ?? 1} characters` })
    .max(opts.max, { message: `must be at most ${opts.max} characters` });

const trimmedOptionalString = (opts: { max: number }) =>
  z
    .string()
    .trim()
    .max(opts.max, { message: `must be at most ${opts.max} characters` })
    .transform((val) => (val === '' ? undefined : val))
    .optional();

// Base schema (used for both full & partial validation)
const profileFieldsSchema = z
  .object({
    firstName: trimmedOptionalString({ max: 50 }),
    lastName: trimmedOptionalString({ max: 50 }),
    avatarUrl: trimmedOptionalString({ max: 400 }),
    handle: trimmedNonEmptyString({ min: MIN_HANDLE_LENGTH, max: MAX_HANDLE_LENGTH }),
  })
  .strict();

/**
 * Validates and trims profile fields against the defined rules.
 *
 * For each field present in `fields`:
 * - Trims whitespace
 * - Sets fields to `undefined` when cleared (empty string)
 * - Enforces min/max length constraints
 *
 * @returns An object containing only the validated, trimmed fields that were provided.
 */
export function validateProfileFields(
  fields: Partial<UpdateProfileProps>
): Partial<UpdateProfileProps> {
  const result = profileFieldsSchema.partial().safeParse(fields);

  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    const msg = path ? `${path}: ${issue.message}` : issue.message;
    throw new Error(msg);
  }

  return result.data;
}

export function validatePassword(value: string) {
  return z
    .string()
    .min(MIN_PASSWORD_LENGTH, {
      message: `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`,
    })
    .max(MAX_PASSWORD_LENGTH, {
      message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    })
    .parse(value);
}

export function validateEmail(value: string) {
  return z.string().email({ message: 'Invalid email address' }).parse(value).toLowerCase();
}

export function validateHandle(value: string) {
  return trimmedNonEmptyString({ min: MIN_HANDLE_LENGTH, max: MAX_HANDLE_LENGTH }).parse(value);
}
