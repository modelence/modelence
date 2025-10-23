import { ZodError } from 'zod';

/**
 * Error thrown when document validation fails against the store schema
 */
export class SchemaValidationError extends Error {
  public readonly zodError: ZodError;

  constructor(message: string, zodError: ZodError) {
    super(message);
    this.name = 'SchemaValidationError';
    this.zodError = zodError;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SchemaValidationError);
    }
  }

  /**
   * Get formatted validation errors
   */
  getErrors() {
    return this.zodError.errors;
  }

  /**
   * Get a human-readable error message
   */
  getFormattedMessage(): string {
    const errors = this.zodError.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    return `${this.message}:\n${errors}`;
  }
}
