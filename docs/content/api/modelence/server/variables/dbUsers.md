# Variable: dbUsers

```ts
const dbUsers: Store<{
  authMethods: ZodObject<{
     google: ZodOptional<ZodObject<{
        id: ZodString;
      }, "strip", ZodTypeAny, {
        id: string;
      }, {
        id: string;
     }>>;
     password: ZodOptional<ZodObject<{
        hash: ZodString;
      }, "strip", ZodTypeAny, {
        hash: string;
      }, {
        hash: string;
     }>>;
   }, "strip", ZodTypeAny, {
     google?: {
        id: string;
     };
     password?: {
        hash: string;
     };
   }, {
     google?: {
        id: string;
     };
     password?: {
        hash: string;
     };
  }>;
  createdAt: ZodDate;
  emails: ZodOptional<ZodArray<ZodObject<{
     address: ZodString;
     verified: ZodBoolean;
   }, "strip", ZodTypeAny, {
     address: string;
     verified: boolean;
   }, {
     address: string;
     verified: boolean;
  }>, "many">>;
  handle: ZodString;
}, Record<string, (this, ...args) => any>>;
```

Defined in: [src/auth/db.ts:4](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/auth/db.ts#L4)
