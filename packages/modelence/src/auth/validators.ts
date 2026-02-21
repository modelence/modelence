import { z } from 'zod';
import { UpdateProfileArgs } from '../methods/types';

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

type FieldRule = {
  min?: number;
  max?: number;
};

const profileFieldRules: Record<keyof UpdateProfileArgs, FieldRule> = {
  firstName: { max: 50 },
  lastName: { max: 50 },
  avatarUrl: { max: 400 },
  handle: { min: 3, max: 50 },
};

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
  fields: Partial<UpdateProfileArgs>
): Partial<UpdateProfileArgs> {
  const validated: Partial<UpdateProfileArgs> = {};

  for (const key of Object.keys(profileFieldRules) as (keyof typeof profileFieldRules)[]) {
    const value = fields[key];

    if (value === undefined) continue;

    const trimmed = value.trim();
    const rules = profileFieldRules[key];

    if (trimmed === '') {
      if (rules.min && rules.min > 0) {
        throw new Error(`${key} cannot be empty.`);
      }
      validated[key] = trimmed;
      continue;
    }

    if (rules.min !== undefined && trimmed.length < rules.min) {
      throw new Error(`${key} must be at least ${rules.min} characters.`);
    }

    if (rules.max !== undefined && trimmed.length > rules.max) {
      throw new Error(`${key} must be at most ${rules.max} characters.`);
    }

    validated[key] = trimmed;
  }

  return validated;
}
