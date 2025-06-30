declare global {
  var modelenceConfig: ModelenceConfig;
}

function getGlobalObject() {
  if (typeof global !== 'undefined') {
    return global;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof self !== 'undefined') {
    return self;
  }
  return {
    modelenceConfig: {} as ModelenceConfig,
  };
}

const globalObject = getGlobalObject();

globalObject.modelenceConfig = {};

interface ModelenceConfig {
  errorHandler?: (error: Error, methodName: string) => void
}

export function getModelenceConfig() {
  return globalObject.modelenceConfig;
}

export function setModelenceConfig(config: ModelenceConfig) {
  globalObject.modelenceConfig = {
    ...globalObject.modelenceConfig,
    ...config,
  };
}
