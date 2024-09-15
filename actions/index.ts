type Action<T extends any[]> = {
  name: string;
  handler: (...args: T) => Promise<any>;
};

const actions: Record<string, Action<any>> = {};

export function createAction<T extends any[]>(name: string, handler: (...args: T) => Promise<any>) {
  if (actions[name]) {
    throw new Error(`Action with name '${name}' is already defined.`);
  }
  actions[name] = { name, handler };
}
