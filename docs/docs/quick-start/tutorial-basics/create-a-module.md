---
sidebar_position: 2
---

# Create a Module

Modules are the core building blocks of a Modelence application. They help you organize your application's functionality into cohesive units that can contain queries, mutations, stores, cron jobs and configurations.

## Example

Create a new file at `src/server/todo/index.ts`:

```typescript title="src/server/todo/index.ts"
import { Module } from 'modelence/server';
import { dbTodos } from './db';

export default new Module('todo', {
  /*
    Include the dbTodos store so it will be automatically
    provisioned in MongoDB when the server starts.
  */
  stores: [dbTodos],

  /*
    Module queries and mutations are similar to the corresponding
    concepts from GraphQL. They support permission checks but
    we will skip them in these examples for simplicity.
  */
  queries: {
    async getOne({ id }) {
      return await dbTodos.findById(id);
    },
    async getAll() {
      return await dbTodos.fetch({});
    }
  },

  mutations: {
    async create({ title, dueDate }, { user }) {
      const { insertedId } = await dbTodos.insertOne({
        title,
        dueDate,
        userId: user.id,
        isCompleted: false
      });
      return insertedId;
    },
    async update({ id, title, dueDate, isCompleted }) {
      return await dbTodos.updateOne({ id }, {
        $set: {
          title,
          dueDate,
          isCompleted
        }
      });
    }
  },
});
```

## Using Modules

To use your module, add it to the `modules` array in your main `app.ts` server file:

```ts title="src/server/app.ts"
import { startApp } from 'modelence/server';
import todoModule from './todo';

startApp({
  modules: [todoModule]
});
```
