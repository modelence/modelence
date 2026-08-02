import { ObjectId } from 'mongodb';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { schema, isFieldPrivate, extractPrivateFieldPaths } from './types';

describe('data/types', () => {
  describe('schema.string', () => {
    test('should create a string schema', () => {
      const stringSchema = schema.string();
      expect(stringSchema.parse('hello')).toBe('hello');
      expect(() => stringSchema.parse(123)).toThrow();
    });
  });

  describe('schema.number', () => {
    test('should create a number schema', () => {
      const numberSchema = schema.number();
      expect(numberSchema.parse(123)).toBe(123);
      expect(numberSchema.parse(45.67)).toBe(45.67);
      expect(() => numberSchema.parse('not a number')).toThrow();
    });
  });

  describe('schema.boolean', () => {
    test('should create a boolean schema', () => {
      const booleanSchema = schema.boolean();
      expect(booleanSchema.parse(true)).toBe(true);
      expect(booleanSchema.parse(false)).toBe(false);
      expect(() => booleanSchema.parse('true')).toThrow();
    });
  });

  describe('schema.date', () => {
    test('should create a date schema', () => {
      const dateSchema = schema.date();
      const now = new Date();
      const parsed = dateSchema.parse(now);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getTime()).toBe(now.getTime());
      expect(() => dateSchema.parse('2024-01-01')).toThrow();
    });
  });

  describe('schema.array', () => {
    test('should create an array schema', () => {
      const arraySchema = schema.array(z.string());
      expect(arraySchema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
      expect(() => arraySchema.parse([1, 2, 3])).toThrow();
    });
  });

  describe('schema.object', () => {
    test('should create an object schema', () => {
      const objectSchema = schema.object({
        name: z.string(),
        age: z.number(),
      });
      const result = objectSchema.parse({ name: 'John', age: 30 });
      expect(result).toEqual({ name: 'John', age: 30 });
      expect(() => objectSchema.parse({ name: 'John' })).toThrow();
    });
  });

  describe('schema.enum', () => {
    test('should create an enum schema', () => {
      const enumSchema = schema.enum(['red', 'green', 'blue']);
      expect(enumSchema.parse('red')).toBe('red');
      expect(enumSchema.parse('blue')).toBe('blue');
      expect(() => enumSchema.parse('yellow')).toThrow();
    });
  });

  describe('schema.embedding', () => {
    test('should create an embedding (array of numbers) schema', () => {
      const embeddingSchema = schema.embedding();
      expect(embeddingSchema.parse([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
      expect(embeddingSchema.parse([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
      expect(() => embeddingSchema.parse(['a', 'b'])).toThrow();
    });
  });

  describe('schema.objectId', () => {
    test('should create an ObjectId schema', () => {
      const objectIdSchema = schema.objectId();
      const id = new ObjectId();
      expect(objectIdSchema.parse(id)).toBe(id);
      expect(() => objectIdSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have ObjectId description', () => {
      const objectIdSchema = schema.objectId();
      expect(objectIdSchema.description).toBe('ObjectId');
    });
  });

  describe('schema.userId', () => {
    test('should create a userId schema', () => {
      const userIdSchema = schema.userId();
      const id = new ObjectId();
      expect(userIdSchema.parse(id)).toBe(id);
      expect(() => userIdSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have UserId description', () => {
      const userIdSchema = schema.userId();
      expect(userIdSchema.description).toBe('UserId');
    });
  });

  describe('schema.ref', () => {
    test('should create a ref schema with string collection', () => {
      const refSchema = schema.ref('users');
      const id = new ObjectId();
      expect(refSchema.parse(id)).toBe(id);
      expect(() => refSchema.parse('not-an-objectid')).toThrow();
    });

    test('should have Ref description', () => {
      const refSchema = schema.ref('posts');
      expect(refSchema.description).toBe('Ref');
    });
  });

  describe('schema.union', () => {
    test('should create a union schema', () => {
      const unionSchema = schema.union([z.string(), z.number()]);
      expect(unionSchema.parse('hello')).toBe('hello');
      expect(unionSchema.parse(123)).toBe(123);
      expect(() => unionSchema.parse(true)).toThrow();
    });
  });

  describe('schema.infer', () => {
    test('should provide type inference helper', () => {
      const testSchema = {
        name: z.string(),
        age: z.number(),
      };
      const inferred = schema.infer(testSchema);
      expect(inferred).toBeDefined();
      expect(typeof inferred).toBe('object');
    });
  });

  describe('schema.private', () => {
    test('should mark string, number, and optional schema fields as private', () => {
      const s = schema.string().private();
      const n = schema.number().private();
      const opt = schema.string().optional().private();
      const optReverse = schema.string().private().optional();

      expect(isFieldPrivate(s)).toBe(true);
      expect(isFieldPrivate(n)).toBe(true);
      expect(isFieldPrivate(opt)).toBe(true);
      expect(isFieldPrivate(optReverse)).toBe(true);
    });

    test('should provide inferFetched helper', () => {
      const testSchema = {
        name: schema.string(),
        password: schema.string().private(),
      };
      const inferred = schema.inferFetched(testSchema);
      expect(inferred).toBeDefined();
    });

    test('should accurately infer types for InferDocumentType, InferFetchedDocumentType, and InferSelectedDocumentType', () => {
      const testSchema = {
        name: schema.string(),
        email: schema.string(),
        password: schema.string().private(),
        secretPin: schema.number().private(),
        bio: schema.string().optional(),
        optionalPrivate: schema.string().optional().private(),
      };

      type FullDoc = schema.infer<typeof testSchema>;
      type FetchedDoc = schema.inferFetched<typeof testSchema>;
      type SelectedDoc = schema.inferSelected<typeof testSchema, 'password'>;

      const fullDoc: FullDoc = {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'secret',
        secretPin: 1234,
      };
      expect(fullDoc.password).toBe('secret');

      const fetchedDoc: FetchedDoc = {
        name: 'Alice',
        email: 'alice@example.com',
      };
      expect(fetchedDoc.name).toBe('Alice');

      // @ts-expect-error password is a private field and should not exist on fetched doc
      void fetchedDoc.password;
      // @ts-expect-error secretPin is a private field and should not exist on fetched doc
      void fetchedDoc.secretPin;

      const selectedDoc: SelectedDoc = {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'secret',
      };
      expect(selectedDoc.password).toBe('secret');

      // @ts-expect-error secretPin was not selected and should not exist on selected doc
      void selectedDoc.secretPin;
    });

    test('isFieldPrivate should identify nullable and default private fields', () => {
      const nullablePrivate = schema.string().private().nullable();
      const defaultPrivate = schema.string().private().default('secret');

      expect(isFieldPrivate(nullablePrivate)).toBe(true);
      expect(isFieldPrivate(defaultPrivate)).toBe(true);
    });

    test('extractPrivateFieldPaths should recursively extract nested and parent private field paths', () => {
      const userProfileSchema = {
        username: schema.string(),
        metadata: schema.object({
          internal: schema.object({
            pin: schema.number().private(),
            score: schema.number(),
          }),
        }),
        securityCredentials: schema
          .object({
            token: schema.string(),
          })
          .private(),
      };

      const paths = extractPrivateFieldPaths(userProfileSchema);
      expect(paths).toEqual(['metadata.internal.pin', 'securityCredentials']);

      type ProfileFetched = schema.inferFetched<typeof userProfileSchema>;

      const fetched: ProfileFetched = {
        username: 'alice',
        metadata: {
          internal: {
            score: 100,
          },
        },
      };

      expect(fetched.metadata.internal.score).toBe(100);
      // @ts-expect-error pin is private inside nested object and should not exist on fetched doc
      void fetched.metadata.internal.pin;
      // @ts-expect-error securityCredentials is a private parent field and should not exist on fetched doc
      void fetched.securityCredentials;

      type ProfileSelected = schema.inferSelected<typeof userProfileSchema, 'securityCredentials'>;

      const selected: ProfileSelected = {
        username: 'alice',
        metadata: {
          internal: {
            score: 100,
          },
        },
        securityCredentials: {
          token: 'secret_token_123',
        },
      };

      expect(selected.securityCredentials.token).toBe('secret_token_123');
      // @ts-expect-error pin was not selected and should remain hidden
      void selected.metadata.internal.pin;
    });

    test('selecting a private parent object should un-hide public fields but keep nested private fields hidden unless explicitly selected', () => {
      const userSchema = {
        name: schema.string(),
        credentials: schema
          .object({
            password: schema.string().private(),
            emails: schema.string(),
          })
          .private(),
      };

      // Selecting only 'credentials' un-hides the object and its public field (emails), but keeps password hidden
      type SelectedCreds = schema.inferSelected<typeof userSchema, 'credentials'>;

      const selectedCreds: SelectedCreds = {
        name: 'Alice',
        credentials: {
          emails: 'alice@example.com',
        },
      };

      expect(selectedCreds.credentials.emails).toBe('alice@example.com');
      // @ts-expect-error password is private inside credentials and was not explicitly selected
      void selectedCreds.credentials.password;

      // Selecting both 'credentials' and 'credentials.password' un-hides password as well
      type SelectedBoth = schema.inferSelected<
        typeof userSchema,
        'credentials' | 'credentials.password'
      >;

      const selectedBoth: SelectedBoth = {
        name: 'Alice',
        credentials: {
          emails: 'alice@example.com',
          password: 'supersecret',
        },
      };

      expect(selectedBoth.credentials.password).toBe('supersecret');
    });

    test('extractPrivateFieldPaths and inferFetched should handle private fields inside ZodArray element schemas', () => {
      const teamSchema = {
        name: schema.string(),
        members: schema.array(
          schema.object({
            name: schema.string(),
            passcode: schema.string().private(),
          })
        ),
      };

      const paths = extractPrivateFieldPaths(teamSchema);
      expect(paths).toEqual(['members.passcode']);

      type TeamFetched = schema.inferFetched<typeof teamSchema>;

      const fetched: TeamFetched = {
        name: 'DevTeam',
        members: [{ name: 'Bob' }],
      };

      expect(fetched.members[0].name).toBe('Bob');
      // @ts-expect-error passcode inside array items is private and should not exist on fetched doc
      void fetched.members[0].passcode;

      type TeamSelected = schema.inferSelected<typeof teamSchema, 'members.passcode'>;

      const selected: TeamSelected = {
        name: 'DevTeam',
        members: [{ name: 'Bob', passcode: '1234' }],
      };

      expect(selected.members[0].passcode).toBe('1234');
    });

    test('should allow selecting nested array private field', () => {
      const organizationSchema = {
        name: schema.string(),
        active: schema.boolean(),
        apiKey: schema.string().private(),
        teamSettings: schema.object({
          memberEmails: schema.array(schema.string()).private(),
          maxQuota: schema.number(),
          region: schema.string(),
        }),
      };

      type FetchedOrg = schema.inferFetched<typeof organizationSchema>;

      const fetched: FetchedOrg = {
        name: 'Acme Corp',
        active: true,
        teamSettings: {
          maxQuota: 500,
          region: 'us-east',
        },
      };

      expect(fetched.teamSettings.maxQuota).toBe(500);
      // @ts-expect-error apiKey is private and should not exist on fetched doc
      void fetched.apiKey;
      // @ts-expect-error teamSettings.memberEmails is private and should not exist on fetched doc
      void fetched.teamSettings.memberEmails;

      type SelectedOrg = schema.inferSelected<
        typeof organizationSchema,
        'apiKey' | 'teamSettings.memberEmails'
      >;

      const selected: SelectedOrg = {
        name: 'Acme Corp',
        active: true,
        apiKey: 'key_live_12345',
        teamSettings: {
          memberEmails: ['admin@acme.com', 'dev@acme.com'],
          maxQuota: 500,
          region: 'us-east',
        },
      };

      expect(selected.apiKey).toBe('key_live_12345');
      expect(selected.teamSettings.memberEmails).toEqual(['admin@acme.com', 'dev@acme.com']);
    });
  });

  describe('complex schema combinations', () => {
    test('should work with nested schemas', () => {
      const userSchema = schema.object({
        name: schema.string(),
        age: schema.number(),
        email: schema.string().email(),
        tags: schema.array(schema.string()),
      });

      const validUser = {
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        tags: ['developer', 'designer'],
      };

      expect(userSchema.parse(validUser)).toEqual(validUser);
    });

    test('should work with optional fields', () => {
      const profileSchema = schema.object({
        username: schema.string(),
        bio: schema.string().optional(),
      });

      expect(profileSchema.parse({ username: 'bob' })).toEqual({ username: 'bob' });
      expect(profileSchema.parse({ username: 'bob', bio: 'Hello' })).toEqual({
        username: 'bob',
        bio: 'Hello',
      });
    });

    test('.private() does not contaminate other schema instances', () => {
      // Two independently-created schemas of the same type.
      const publicStringSchema = schema.string();
      const privateStringSchema = schema.string().private();

      // Only the explicitly-marked instance should be considered private.
      expect(isFieldPrivate(publicStringSchema)).toBe(false);
      expect(isFieldPrivate(privateStringSchema)).toBe(true);

      const testSchema = {
        publicField: publicStringSchema,
        privateField: privateStringSchema,
      };

      const privatePaths = extractPrivateFieldPaths(testSchema);
      expect(privatePaths).toEqual(['privateField']);
    });

    test('InferFetchedDocumentType recursively strips private fields from optional/nullable/default/effects-wrapped objects', () => {
      const targetSchema = {
        title: schema.string(),
        optionalObj: schema
          .object({
            publicBio: schema.string(),
            secretPin: schema.number().private(),
          })
          .optional(),
        nullableObj: schema
          .object({
            publicNote: schema.string(),
            secretKey: schema.string().private(),
          })
          .nullable(),
        effectsObj: schema
          .object({
            publicField: schema.string(),
            secretField: schema.string().private(),
          })
          .refine(() => true),
        brandedField: schema.string().private().brand<'ApiKey'>(),
        readonlyObj: schema
          .object({
            publicProp: schema.string(),
            secretProp: schema.string().private(),
          })
          .readonly(),
        catchField: schema.string().private().catch('fallback'),
      };

      type Fetched = import('./types').InferFetchedDocumentType<typeof targetSchema>;

      expectTypeOf<Fetched>().toMatchTypeOf<{
        title: string;
        optionalObj?: { publicBio: string };
        nullableObj: { publicNote: string } | null;
        effectsObj: { publicField: string };
        readonlyObj: { publicProp: string };
      }>();

      // @ts-expect-error brandedField was private and must be omitted from Fetched type
      type CheckBranded = Fetched['brandedField'];
      // @ts-expect-error catchField was private and must be omitted from Fetched type
      type CheckCatch = Fetched['catchField'];
    });

    test('extractPrivateFieldPaths and isFieldPrivate handle ZodUnion, ZodBranded, ZodReadonly, ZodCatch, and ZodEffects wrappers', () => {
      // 1. ZodUnion
      const unionSchema = {
        auth: schema.union([
          z.object({ username: schema.string(), password: schema.string().private() }),
          z.object({ token: schema.string().private() }),
        ]),
      };
      expect(extractPrivateFieldPaths(unionSchema)).toEqual(['auth.password', 'auth.token']);

      // 2. ZodIntersection
      const intersectionSchema = {
        profile: z.intersection(
          z.object({ publicName: schema.string() }),
          z.object({ secretPin: schema.number().private() })
        ),
      };
      expect(extractPrivateFieldPaths(intersectionSchema)).toEqual(['profile.secretPin']);

      // 3. ZodBranded (both top-level branded primitive and nested branded object)
      const brandedSchema = {
        apiKey: schema.string().private().brand<'ApiKey'>(),
        brandedConfig: z
          .object({
            secret: schema.string().private(),
          })
          .brand<'BrandedConfig'>(),
      };
      expect(isFieldPrivate(brandedSchema.apiKey)).toBe(true);
      expect(extractPrivateFieldPaths(brandedSchema)).toEqual(['apiKey', 'brandedConfig.secret']);

      // 4. ZodReadonly
      const readonlySchema = {
        config: schema
          .object({
            publicSetting: schema.string(),
            privateKey: schema.string().private(),
          })
          .readonly(),
      };
      expect(extractPrivateFieldPaths(readonlySchema)).toEqual(['config.privateKey']);

      // 5. ZodCatch (both top-level catch primitive and nested catch object)
      const catchSchema = {
        fallbackToken: schema.string().private().catch('default_token'),
        catchObj: z
          .object({
            secretPin: schema.number().private(),
          })
          .catch({ secretPin: 0 }),
      };
      expect(isFieldPrivate(catchSchema.fallbackToken)).toBe(true);
      expect(extractPrivateFieldPaths(catchSchema)).toEqual([
        'fallbackToken',
        'catchObj.secretPin',
      ]);

      // 6. ZodEffects
      const effectsSchema = {
        user: schema
          .object({
            id: schema.string(),
            ssn: schema.string().private(),
          })
          .transform((val) => val),
      };
      expect(extractPrivateFieldPaths(effectsSchema)).toEqual(['user.ssn']);
    });
  });
});
