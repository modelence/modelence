# Class: Module

Defined in: [src/app/module.ts:39](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/app/module.ts#L39)

The Module class is a core building block of a Modelence application that encapsulates related functionality.
Modules can contain stores, queries, mutations, routes, cron jobs and configurations.

## Example

```ts
const todoModule = new Module('todo', {
  stores: [dbTodos],
  queries: {
    async getAll() {
      // Fetch and return all Todo items
    }
  },
  mutations: {
    async create({ title }, { user }) {
      // Create a new Todo item
    }
  }
});
```

## Constructors

### Constructor

```ts
new Module(name, options): Module;
```

Defined in: [src/app/module.ts:70](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/app/module.ts#L70)

Creates a new Module instance

#### Parameters

##### name

`string`

The unique name of the module.
This name is used to namespace queries, mutations,
cron jobs and configuration values with a prefix (e.g. "todo.create")

##### options

Module configuration options

###### configSchema?

`ConfigSchema` = `{}`

###### cronJobs?

`Record`\<`string`, `CronJobInputParams`\> = `{}`

###### mutations?

`Mutations` = `{}`

###### queries?

`Queries` = `{}`

###### routes?

[`RouteDefinition`](/docs/api-reference/modelence/server/type-aliases/RouteDefinition.md)[] = `[]`

###### stores?

`Stores` = `[]`

#### Returns

`Module`
