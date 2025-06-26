export abstract class ModelenceError extends Error {
  abstract status: number;
}

export class AuthError extends ModelenceError {
  status = 401;

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ValidationError extends ModelenceError {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ModelenceError {
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
