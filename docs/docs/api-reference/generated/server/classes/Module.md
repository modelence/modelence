[**modelence**](/docs/api-reference/README.md)

***

[modelence](/docs/api-reference/README.md) / [server](/docs/api-reference/server/README.md) / Module

# Class: Module

Defined in: [app/module.ts:39](https://github.com/modelence/modelence/blob/main/app/module.ts#L39)

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

### new Module()

```ts
new Module(name, options): Module
```

Defined in: [app/module.ts:70](https://github.com/modelence/modelence/blob/main/app/module.ts#L70)

Creates a new Module instance

#### Parameters

##### name

`string`

The unique name of the module.
This name is used to namespace queries, mutations,
cron jobs and configuration values with a prefix (e.g. "todo.create")

##### options

Module configuration options

###### configSchema

`ConfigSchema` = `{}`

###### cronJobs

`Record`\<`string`, `CronJobInputParams`\> = `{}`

###### mutations

`Mutations` = `{}`

###### queries

`Queries` = `{}`

###### routes

[`RouteDefinition`](/docs/api-reference/server/type-aliases/RouteDefinition.md)[] = `[]`

###### stores

`Stores` = `[]`

#### Returns

[`Module`](/docs/api-reference/server/classes/Module.md)
