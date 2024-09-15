type Loader<T extends any[]> = {
  name: string;
  handler: (...args: T) => Promise<any>;
};

const loaders: Record<string, Loader<any>> = {};

export function createLoader<T extends any[]>(name: string, handler: (...args: T) => Promise<any>) {
  if (loaders[name]) {
    throw new Error(`Loader with name '${name}' is already defined.`);
  }
  loaders[name] = { name, handler };
}

export async function callLoader(name: string, ...args: any[]) {
  const loader = loaders[name];
  if (!loader) {
    throw new Error(`Loader with name '${name}' is not defined.`);
  }
  return await loader.handler(...args);
}
