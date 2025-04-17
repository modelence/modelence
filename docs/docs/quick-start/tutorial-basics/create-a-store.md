---
sidebar_position: 1
---

# Using a Store

Stores in Modelence are MongoDB collections with built-in TypeScript support, schema and helper methods. They help you to:

- Define **type-safe schemas** for your data
- Handle **CRUD operations** with MongoDB
- Add **custom methods** to your documents
- Configure **indexes** for better performance

## Create a Store

You can define a store anywhere in your project, as long as it is imported and passed into a Module (we will cover Modules in the next tutorial). While you can define everything in a single file, the recommended approach in Modelence is to group code by modules / domains into separate directories. For our Todo app, we'll just put everything into a single `todo` directory on the server side. Create an `src/server/todo` directory and add a `db.ts` file to it which we'll use to define our store for todo items:

```typescript title="src/server/todo/db.ts"
import { Store, schema } from 'modelence';

export const dbTodos = new Store('todos', {
  // Define the schema for your documents. Modelence schema is based on and closely resembles Zod types.
  schema: {
    title: schema.string(),
    isCompleted: schema.boolean(), 
    dueDate: schema.date().optional(),
    userId: schema.userId(), // Built-in Modelence type for user references
    createdAt: schema.date(),
  },

  // Configure MongoDB indexes
  indexes: [
    { key: { userId: 1 } },
    { key: { dueDate: 1 } },
  ],

  // Add custom methods to documents
  methods: {
    isOverdue() {
      return this.dueDate < new Date();
    }
  }
});
```

## Using the Store

Once defined, you can use your Store object to perform any operations on your collection.
For example:

```typescript
const { insertedId } = await dbTodos.insertOne({
  title: 'Buy groceries', 
  isCompleted: false, 
  dueDate: new Date('2023-01-31'),
  userId: '123',
  createdAt: new Date()
});

const todo = await dbTodos.findById(insertedId);

console.log(todo.isOverdue());
```

## Working with Documents

Stores provide a comprehensive set of methods for working with MongoDB documents, including finding, inserting, updating, and deleting records. All methods are fully typed with TypeScript.

See the [Store API Reference](../../api-reference/store) for a complete list of available methods and their usage.

:::tip
Stores automatically handle MongoDB connection management, collection provisioning and index creation (as you define in the `indexes` array). Just define your Store and start using it - Modelence takes care of the rest.
:::
