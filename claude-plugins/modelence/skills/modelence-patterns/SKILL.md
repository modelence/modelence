---
name: modelence-patterns
description: Complete working examples of Modelence framework patterns — Module, Store, queries, mutations, configSchema, cron jobs, and React pages using modelenceQuery/modelenceMutation. Use when creating or modifying Modelence modules, stores, queries, mutations, cron jobs, migrations, or client pages that call them.
---

# Modelence patterns

Reference implementations for the core Modelence building blocks. Match these patterns exactly — argument validation with zod, auth checks with `AuthError`, ownership verification, and typed client calls.

## Example Module (src/server/example/index.ts)

```ts
import z from 'zod';
import { AuthError, time } from 'modelence';
import { Module, ObjectId, UserInfo, getConfig, Store, schema } from 'modelence/server';

const dbExampleItems = new Store('exampleItems', {
  schema: {
    title: schema.string(),
    createdAt: schema.date(),
    userId: schema.userId(),
  },
  indexes: [{ key: { userId: 1 } }]
});

const dailyTestCron = {
  description: 'Daily cron job example',
  interval: time.days(1),
  handler: async () => {
    // Any code written here will run daily.
  },
};

export default new Module('example', {
  configSchema: {
    modelenceDemoUsername: {
      type: 'string',
      default: 'demo@modelence.dev',
      isPublic: true,
    },
    modelenceDemoApiKey: {
      type: 'secret',
      default: '',
      isPublic: false,
    },
    itemsPerPage: {
      type: 'number',
      default: 5,
      isPublic: false,
    },
  },

  stores: [dbExampleItems],

  queries: {
    getItem: async (args: unknown, { user }: { user: UserInfo | null }) => {
      if (!user) {
        throw new AuthError('Not authenticated');
      }

      const { itemId } = z.object({ itemId: z.string() }).parse(args);
      const exampleItem = await dbExampleItems.requireOne({ _id: new ObjectId(itemId) });

      if (exampleItem.userId.toString() !== user.id) {
        throw new AuthError('Not authorized');
      }

      return {
        title: exampleItem.title,
        createdAt: exampleItem.createdAt,
      };
    },

    getItems: async (_args: unknown, { user }: { user: UserInfo | null }) => {
      if (!user) {
        throw new AuthError('Not authenticated');
      }

      const itemsPerPage = getConfig('example.itemsPerPage') as number;
      const exampleItems = await dbExampleItems.fetch({
        userId: new ObjectId(user.id),
      }, { limit: itemsPerPage })
      return exampleItems.map((item) => ({
        _id: item._id.toString(),
        title: item.title,
        createdAt: item.createdAt,
      }));
    }
  },

  mutations: {
    createItem: async (args: unknown, { user }: { user: UserInfo | null }) => {
      if (!user) {
        throw new AuthError('Not authenticated');
      }

      const { title } = z.object({ title: z.string() }).parse(args);

      await dbExampleItems.insertOne({ title, createdAt: new Date(), userId: new ObjectId(user.id) });
    },

    updateItem: async (args: unknown, { user }: { user: UserInfo | null }) => {
      if (!user) {
        throw new AuthError('Not authenticated');
      }

      const { itemId, title } = z.object({ itemId: z.string(), title: z.string() }).parse(args);

      const exampleItem = await dbExampleItems.requireOne({ _id: new ObjectId(itemId) });
      if (exampleItem.userId.toString() !== user.id) {
        throw new AuthError('Not authorized');
      }

      const { modifiedCount } = await dbExampleItems.updateOne({ _id: new ObjectId(itemId) }, { $set: { title } });

      if (modifiedCount === 0) {
        throw new Error('Item not found');
      }
    },
  },

  cronJobs: {
    dailyTest: dailyTestCron
  }
});
```

## Example Page (src/client/pages/ExamplePage.tsx)

```tsx
import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { modelenceQuery, modelenceMutation, createQueryKey } from '@modelence/react-query';
import { Button } from '../components/ui/Button';

type ExampleItem = {
  title: string;
  createdAt: Date;
};

export default function ExamplePage() {
  const { itemId } = useParams<{ itemId: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    ...modelenceQuery<ExampleItem>('example.getItem', { itemId }),
    enabled: !!itemId,
  });

  const { mutate: createItem, isPending: isCreatingItem } = useMutation({
    ...modelenceMutation('example.createItem'),
  });

  const invalidateItem = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: createQueryKey('example.getItem', { itemId }) });
  }, [queryClient, itemId]);

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {error && <div>Error: {(error as Error).message}</div>}
      {data && (
        <>
          <h1>{data.title}</h1>
          <p>Created: {new Date(data.createdAt).toLocaleString()}</p>
        </>
      )}
      <Button onClick={invalidateItem}>Invalidate Item</Button>
      <Button onClick={() => createItem({ title: 'New Item' })} disabled={isCreatingItem}>Create Item</Button>
    </div>
  );
}
```

## Migrations

Migrations are versioned data migration handlers that run once on app startup, inside the app process. They import and use Stores defined in the module's db.ts — never define a Store inside a migration file. A migration file contains only the handler logic that operates on existing Stores.
