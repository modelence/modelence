import { ModelenceError, AuthError, ValidationError, RateLimitError } from './error';

describe('ModelenceError', () => {
  describe('AuthError', () => {
    test('should create AuthError with correct status', () => {
      const error = new AuthError('Unauthorized');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ModelenceError);
      expect(error.status).toBe(401);
      expect(error.name).toBe('AuthError');
      expect(error.message).toBe('Unauthorized');
    });
  });

  describe('ValidationError', () => {
    test('should create ValidationError with correct status', () => {
      const error = new ValidationError('Invalid input');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ModelenceError);
      expect(error.status).toBe(400);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid input');
    });
  });

  describe('RateLimitError', () => {
    test('should create RateLimitError with correct status', () => {
      const error = new RateLimitError('Too many requests');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ModelenceError);
      expect(error.status).toBe(429);
      expect(error.name).toBe('RateLimitError');
      expect(error.message).toBe('Too many requests');
    });
  });
});
