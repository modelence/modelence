import { setErrorHandler, handleError } from './errorHandler';

describe('client/errorHandler', () => {
  beforeEach(() => {
    // Reset to default error handler before each test
    setErrorHandler((error, methodName) => {
      throw new Error(`Error calling method '${methodName}': ${error.toString()}`);
    });
  });

  describe('handleError', () => {
    test('should throw error with default handler', () => {
      const error = new Error('Test error');
      expect(() => handleError(error, 'testMethod')).toThrow(
        "Error calling method 'testMethod': Error: Test error"
      );
    });

    test('should use custom error handler when set', () => {
      let handlerCalled = false;
      let handlerError: Error | null = null;
      let handlerMethod: string | null = null;

      const customHandler = (error: Error, methodName: string) => {
        handlerCalled = true;
        handlerError = error;
        handlerMethod = methodName;
      };
      setErrorHandler(customHandler);

      const error = new Error('Custom error');
      handleError(error, 'customMethod');

      expect(handlerCalled).toBe(true);
      expect(handlerError).toBe(error);
      expect(handlerMethod).toBe('customMethod');
    });

    test('should handle multiple calls with custom handler', () => {
      const errors: Array<{ error: Error; method: string }> = [];
      setErrorHandler((error, methodName) => {
        errors.push({ error, method: methodName });
      });

      handleError(new Error('Error 1'), 'method1');
      handleError(new Error('Error 2'), 'method2');

      expect(errors).toHaveLength(2);
      expect(errors[0].error.message).toBe('Error 1');
      expect(errors[0].method).toBe('method1');
      expect(errors[1].error.message).toBe('Error 2');
      expect(errors[1].method).toBe('method2');
    });

    test('should override previous error handler', () => {
      let firstCalled = false;
      let secondCalled = false;

      const firstHandler = () => {
        firstCalled = true;
      };
      const secondHandler = () => {
        secondCalled = true;
      };

      setErrorHandler(firstHandler);
      setErrorHandler(secondHandler);

      const error = new Error('Test');
      handleError(error, 'method');

      expect(firstCalled).toBe(false);
      expect(secondCalled).toBe(true);
    });

    test('should handle different error types', () => {
      const handledErrors: Error[] = [];
      setErrorHandler((error) => {
        handledErrors.push(error);
      });

      const standardError = new Error('Standard error');
      const typeError = new TypeError('Type error');
      const customError = new (class extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      })('Custom error');

      handleError(standardError, 'method1');
      handleError(typeError, 'method2');
      handleError(customError, 'method3');

      expect(handledErrors).toHaveLength(3);
      expect(handledErrors[0]).toBe(standardError);
      expect(handledErrors[1]).toBe(typeError);
      expect(handledErrors[2]).toBe(customError);
    });
  });

  describe('setErrorHandler', () => {
    test('should accept custom error handler function', () => {
      const customHandler = () => {};
      expect(() => setErrorHandler(customHandler)).not.toThrow();
    });

    test('should allow error handler that logs instead of throwing', () => {
      const logged: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      };

      setErrorHandler((error, methodName) => {
        console.error(`[${methodName}]:`, error.message);
      });

      const error = new Error('Logged error');
      handleError(error, 'logMethod');

      expect(logged[0]).toBe('[logMethod]: Logged error');

      console.error = originalError;
    });

    test('should return result from custom error handler', () => {
      const customHandler = (error: Error, methodName: string) => {
        return { customResult: true, error, methodName };
      };
      setErrorHandler(customHandler);

      const error = new Error('Test error');
      const result = handleError(error, 'testMethod');

      expect(result).toEqual({
        customResult: true,
        error,
        methodName: 'testMethod',
      });
    });
  });
});
