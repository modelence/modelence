---
sidebar_position: 2
---

# Create a Module

Modules are the core building blocks of a Modelence application. They help you organize your application's functionality into cohesive units that can contain queries, mutations, and data stores.

## Example

Create a new file at `src/server/modules/users.ts`:

```typescript title="src/server/modules/users.ts"
import { Module } from 'modelence';

export const productsModule = new Module('product', {
  // Define queries for reading data
  queries: {
    getProduct: async ({ id }) => {
      // Query implementation
    },
    listProducts: async () => {
      // Query implementation
    }
  },

  // Define mutations for modifying data
  mutations: {
    createProduct: async ({ name, email }) => {
      // Mutation implementation
    },
    updateProduct: async ({ id, data }) => {
      // Mutation implementation
    }
  },

  // Define data stores
  stores: [
    {
      name: 'products',
      schema: {
        name: String,
        price: Number,
        createdAt: Date
      }
    }
  ]
});
```

## Using Modules

To use your module, add it to the `modules` array in your main server file:

```ts title="src/server/app.ts"
import { startApp } from 'modelence';
import { usersModule } from './modules/users';

startApp({
  modules: [usersModule]
});
```