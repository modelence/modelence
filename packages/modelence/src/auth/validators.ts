import { z } from 'zod';

export function validatePassword(value: string) {
  return z.string().min(8, { message: 'Password must contain at least 8 characters' }).parse(value);
}

export function validateEmail(value: string) {
  return z.string().email({ message: 'Invalid email address' }).parse(value);
}
