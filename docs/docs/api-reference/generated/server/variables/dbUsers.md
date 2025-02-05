[**modelence**](/docs/api-reference/README.md)

***

[modelence](/docs/api-reference/README.md) / [server](/docs/api-reference/server/README.md) / dbUsers

# Variable: dbUsers

```ts
const dbUsers: Store<{
  authMethods: ZodObject<{
     google: ZodOptional<ZodObject<{
        id: ZodString;
       }, "strip", {
        id: string;
       }, {
        id: string;
       }>>;
     password: ZodOptional<ZodObject<{
        hash: ZodString;
       }, "strip", {
        hash: string;
       }, {
        hash: string;
       }>>;
    }, "strip", {
     google: {
        id: string;
       };
     password: {
        hash: string;
       };
    }, {
     google: {
        id: string;
       };
     password: {
        hash: string;
       };
    }>;
  createdAt: ZodDate;
  emails: ZodOptional<ZodArray<ZodObject<{
     address: ZodString;
     verified: ZodBoolean;
    }, "strip", {
     address: string;
     verified: boolean;
    }, {
     address: string;
     verified: boolean;
    }>>>;
  handle: ZodString;
}, Record<string, (this, ...args) => any>>;
```

Defined in: [auth/user.ts:9](https://github.com/modelence/modelence/blob/main/auth/user.ts#L9)
