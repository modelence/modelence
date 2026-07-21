export abstract class ModelenceError extends Error {
  abstract status: number;
  /**
   * Optional machine-readable error code so clients can branch on the kind of
   * error without string-matching `message` (which may be reworded or localized).
   */
  code?: string;
}

export class AuthError extends ModelenceError {
  status = 401;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export class ValidationError extends ModelenceError {
  status = 400;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export class RateLimitError extends ModelenceError {
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
