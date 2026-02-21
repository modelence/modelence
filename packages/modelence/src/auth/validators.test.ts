import { validateEmail, validatePassword, validateHandle, validateProfileFields } from './validators';

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

  describe('validateHandle', () => {
    test('should accept valid handles between 3 and 50 characters', () => {
      expect(validateHandle('abc')).toBe('abc');
      expect(validateHandle('my_handle')).toBe('my_handle');
      expect(validateHandle('user123')).toBe('user123');
    });

    test('should throw error for handle shorter than 3 characters', () => {
      expect(() => validateHandle('ab')).toThrow('Handle must be at least 3 characters');
      expect(() => validateHandle('a')).toThrow('Handle must be at least 3 characters');
      expect(() => validateHandle('')).toThrow();
    });

    test('should throw error for handle longer than 50 characters', () => {
      const longHandle = 'a'.repeat(51);
      expect(() => validateHandle(longHandle)).toThrow('Handle must be at most 50 characters');
    });

    test('should accept handle at exactly 3 and 50 characters', () => {
      expect(validateHandle('abc')).toBe('abc');
      const fiftyCharHandle = 'a'.repeat(50);
      expect(validateHandle(fiftyCharHandle)).toBe(fiftyCharHandle);
    });
  });

  describe('validateProfileFields', () => {
    test('should return empty object when no fields provided', () => {
      expect(validateProfileFields({})).toEqual({});
    });

    test('should skip undefined fields', () => {
      const result = validateProfileFields({ firstName: undefined });
      expect(result).toEqual({});
    });

    test('should trim whitespace from field values', () => {
      const result = validateProfileFields({ firstName: '  John  ' });
      expect(result).toEqual({ firstName: 'John' });
    });

    test('should allow clearing optional fields (no min) with empty string', () => {
      const result = validateProfileFields({ firstName: '' });
      expect(result).toEqual({ firstName: '' });
    });

    test('should allow clearing optional fields with whitespace-only string', () => {
      const result = validateProfileFields({ firstName: '   ' });
      expect(result).toEqual({ firstName: '' });
    });

    test('should throw when clearing a field that has min > 0', () => {
      expect(() => validateProfileFields({ handle: '' })).toThrow('handle cannot be empty.');
      expect(() => validateProfileFields({ handle: '   ' })).toThrow('handle cannot be empty.');
    });

    test('should throw for handle shorter than min length', () => {
      expect(() => validateProfileFields({ handle: 'ab' })).toThrow(
        'handle must be at least 3 characters.'
      );
    });

    test('should throw for firstName exceeding max length', () => {
      const longName = 'a'.repeat(51);
      expect(() => validateProfileFields({ firstName: longName })).toThrow(
        'firstName must be at most 50 characters.'
      );
    });

    test('should throw for avatarUrl exceeding max length', () => {
      const longUrl = 'a'.repeat(401);
      expect(() => validateProfileFields({ avatarUrl: longUrl })).toThrow(
        'avatarUrl must be at most 400 characters.'
      );
    });

    test('should validate multiple fields at once', () => {
      const result = validateProfileFields({
        firstName: ' Alice ',
        lastName: ' Smith ',
        handle: 'alice_smith',
      });
      expect(result).toEqual({
        firstName: 'Alice',
        lastName: 'Smith',
        handle: 'alice_smith',
      });
    });

    test('should only include provided fields in the result', () => {
      const result = validateProfileFields({ lastName: 'Doe' });
      expect(result).toEqual({ lastName: 'Doe' });
      expect(result).not.toHaveProperty('firstName');
      expect(result).not.toHaveProperty('handle');
      expect(result).not.toHaveProperty('avatarUrl');
    });

    test('should accept handle at exactly min and max boundaries', () => {
      expect(validateProfileFields({ handle: 'abc' })).toEqual({ handle: 'abc' });
      const fiftyCharHandle = 'a'.repeat(50);
      expect(validateProfileFields({ handle: fiftyCharHandle })).toEqual({ handle: fiftyCharHandle });
    });
  });
});
