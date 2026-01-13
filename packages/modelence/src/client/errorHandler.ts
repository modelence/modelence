export type ErrorHandler = (error: Error, methodName: string) => void;

let errorHandler: ErrorHandler = (error, methodName) => {
  console.error(`Error calling method '${methodName}':`, error);
};

export function setErrorHandler(handler: ErrorHandler) {
  errorHandler = handler;
}

export function handleError(error: Error, methodName: string) {
  return errorHandler(error, methodName);
}
