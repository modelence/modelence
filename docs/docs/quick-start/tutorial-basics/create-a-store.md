---
sidebar_position: 1
---

# Using Stores

Stores in Modelence are MongoDB collections with built-in TypeScript support, schema and helper methods. They help you:

- Define **type-safe schemas** for your data
- Handle **CRUD operations** with MongoDB
- Add **custom methods** to your documents
- Configure **indexes** for better performance

## Create a Store

Create a new store in your module file:

```typescript title="src/server/todos/db.ts"
import { Store, schema } from 'modelence';

export const dbTodos = new Store('todos', {
  // Define the schema for your documents. Modelence schema is based on and closely resembles Zod types.
  schema: {
    title: schema.string(),
    isCompleted: schema.boolean(), 
    dueDate: schema.date().optional(),
    userId: schema.userId(), // Build-in Modelence type for user references
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

See the [Store API Reference](../../api-reference/store.md) for a complete list of available methods and their usage.

:::tip
Stores automatically handle MongoDB connection management, collection provisioning and index creation (as you define in the `indexes` array). Just define your store and start using it - Modelence takes care of the rest.
:::
