import { validateEmail, validatePassword } from './validators';

describe('auth/validators', () => {
  describe('validatePassword', () => {
    test('should accept valid password with 8+ characters', () => {
      expect(validatePassword('password123')).toBe('password123');
      expect(validatePassword('VerySecurePassword!@#')).toBe('VerySecurePassword!@#');
      expect(validatePassword('12345678')).toBe('12345678');
    });

    test('should throw error for password less than 8 characters', () => {
      expect(() => validatePassword('short')).toThrow(
        'Password must contain at least 8 characters'
      );
      expect(() => validatePassword('1234567')).toThrow(
        'Password must contain at least 8 characters'
      );
      expect(() => validatePassword('')).toThrow();
    });

    test('should handle edge case with exactly 8 characters', () => {
      expect(validatePassword('12345678')).toBe('12345678');
    });
  });

  describe('validateEmail', () => {
    test('should accept valid email addresses', () => {
      expect(validateEmail('test@example.com')).toBe('test@example.com');
      expect(validateEmail('user.name+tag@example.co.uk')).toBe('user.name+tag@example.co.uk');
      expect(validateEmail('valid_email@domain.com')).toBe('valid_email@domain.com');
    });

    test('should throw error for invalid email addresses', () => {
      expect(() => validateEmail('notanemail')).toThrow('Invalid email address');
      expect(() => validateEmail('missing@domain')).toThrow('Invalid email address');
      expect(() => validateEmail('@example.com')).toThrow('Invalid email address');
      expect(() => validateEmail('user@')).toThrow('Invalid email address');
      expect(() => validateEmail('')).toThrow();
    });

    test('should handle edge cases', () => {
      expect(validateEmail('a@b.co')).toBe('a@b.co');
    });
  });
});
