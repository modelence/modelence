export type ErrorHandler = (error: Error, methodName: string) => void;

let errorHandler: ErrorHandler = (error, methodName) => {
  throw new Error(`Error calling method '${methodName}': ${error.toString()}`);
};

export function setErrorHandler(handler: ErrorHandler) {
  errorHandler = handler;
}

export function handleError(error: Error, methodName: string) {
  return errorHandler(error, methodName);
}
