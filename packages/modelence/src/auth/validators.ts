import { z } from 'zod';
import { UpdateProfileProps } from '../methods/types';

export function validatePassword(value: string) {
  return z.string().min(8, { message: 'Password must contain at least 8 characters' }).parse(value);
}

export function validateEmail(value: string) {
  return z.string().email({ message: 'Invalid email address' }).parse(value);
}

export function validateHandle(value: string) {
  return z
    .string()
    .min(3, { message: 'Handle must be at least 3 characters' })
    .max(50, { message: 'Handle must be at most 50 characters' })
    .parse(value);
}

function trimmedString(opts: { min?: number; max?: number }) {
  return z
    .string()
    .transform((v) => v.trim())
    .superRefine((val, ctx) => {
      if (val === '') {
        if (opts.min && opts.min > 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cannot be empty.` });
        }
        return;
      }
      if (opts.min !== undefined && val.length < opts.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: opts.min,
          type: 'string',
          inclusive: true,
          message: `must be at least ${opts.min} characters.`,
        });
      }
      if (opts.max !== undefined && val.length > opts.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: opts.max,
          type: 'string',
          inclusive: true,
          message: `must be at most ${opts.max} characters.`,
        });
      }
    });
}

const profileFieldsSchema = z.object({
  firstName: trimmedString({ max: 50 }),
  lastName: trimmedString({ max: 50 }),
  avatarUrl: trimmedString({ max: 400 }),
  handle: trimmedString({ min: 3, max: 50 }),
});

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
  const providedKeys = Object.keys(fields).filter(
    (key): key is keyof UpdateProfileProps =>
      key in profileFieldsSchema.shape && fields[key as keyof UpdateProfileProps] !== undefined
  );

  const partialSchema = profileFieldsSchema.pick(
    Object.fromEntries(providedKeys.map((key) => [key, true])) as Record<
      keyof UpdateProfileProps,
      true
    >
  );

  const result = partialSchema.safeParse(fields);

  if (!result.success) {
    const firstError = result.error.errors[0];
    throw new Error(`${firstError.path[0]} ${firstError.message}`);
  }

  return result.data;
}
