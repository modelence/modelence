import { getModelenceConfig, setModelenceConfig } from "./config";

export type ErrorHandler = (error: Error, methodName: string) => void;

const defaultErrorHandler: ErrorHandler = (error, methodName) => {
  throw new Error(`Error calling method '${methodName}': ${error.toString()}`);
};

export function setErrorHandler(errorHandler: ErrorHandler) {
  setModelenceConfig({ errorHandler });
}

export function handleError(error: Error, methodName: string) {
  const errorHandler = getModelenceConfig().errorHandler || defaultErrorHandler;
  return errorHandler(error, methodName);
}
