[**modelence**](/docs/api-reference/README.md)

***

[modelence](/docs/api-reference/README.md) / [server](/docs/api-reference/server/README.md) / ObjectId

# Class: ObjectId

Defined in: node\_modules/bson/bson.d.ts:1343

A class representation of the BSON ObjectId type.

## Extends

- `BSONValue`

## Accessors

### \_bsontype

#### Get Signature

```ts
get _bsontype(): "ObjectId"
```

Defined in: node\_modules/bson/bson.d.ts:1344

##### Returns

`"ObjectId"`

#### Overrides

```ts
BSONValue._bsontype
```

***

### id

#### Get Signature

```ts
get id(): Uint8Array
```

Defined in: node\_modules/bson/bson.d.ts:1391

The ObjectId bytes

##### Returns

`Uint8Array`

## Constructors

### new ObjectId()

```ts
new ObjectId(inputId): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1354

Create ObjectId from a number.

#### Parameters

##### inputId

`number`

A number.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Deprecated

Instead, use `static createFromTime()` to set a numeric value for the new ObjectId.

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(inputId): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1360

Create ObjectId from a 24 character hex string.

#### Parameters

##### inputId

`string`

A 24 character hex string.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(inputId): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1366

Create ObjectId from the BSON ObjectId type.

#### Parameters

##### inputId

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

The BSON ObjectId type.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(inputId): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1372

Create ObjectId from the object type that has the toHexString method.

#### Parameters

##### inputId

`ObjectIdLike`

The ObjectIdLike type.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(inputId): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1378

Create ObjectId from a 12 byte binary Buffer.

#### Parameters

##### inputId

`Uint8Array`

A 12 byte binary Buffer.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1380

To generate a new ObjectId, use ObjectId() with no argument.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

### new ObjectId()

```ts
new ObjectId(inputId?): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1386

Implementation overload.

#### Parameters

##### inputId?

All input types that are used in the constructor implementation.

`string` | `number` | `Uint8Array` | [`ObjectId`](/docs/api-reference/server/classes/ObjectId.md) | `ObjectIdLike`

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

#### Overrides

```ts
BSONValue.constructor
```

## Methods

### createFromBase64()

```ts
static createFromBase64(base64): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1434

Creates an ObjectId instance from a base64 string

#### Parameters

##### base64

`string`

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

***

### createFromHexString()

```ts
static createFromHexString(hexString): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1432

Creates an ObjectId from a hex string representation of an ObjectId.

#### Parameters

##### hexString

`string`

create a ObjectId from a passed in 24 character hexstring.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

***

### createFromTime()

```ts
static createFromTime(time): ObjectId
```

Defined in: node\_modules/bson/bson.d.ts:1426

Creates an ObjectId from a second based number, with the rest of the ObjectId zeroed out. Used for comparisons or sorting the ObjectId.

#### Parameters

##### time

`number`

an integer number representing a number of seconds.

#### Returns

[`ObjectId`](/docs/api-reference/server/classes/ObjectId.md)

***

### equals()

```ts
equals(otherId): boolean
```

Defined in: node\_modules/bson/bson.d.ts:1416

Compares the equality of this ObjectId with `otherID`.

#### Parameters

##### otherId

ObjectId instance to compare against.

`undefined` | `null` | `string` | [`ObjectId`](/docs/api-reference/server/classes/ObjectId.md) | `ObjectIdLike`

#### Returns

`boolean`

***

### generate()

```ts
static generate(time?): Uint8Array
```

Defined in: node\_modules/bson/bson.d.ts:1402

Generate a 12 byte id buffer used in ObjectId's

#### Parameters

##### time?

`number`

pass in a second based timestamp.

#### Returns

`Uint8Array`

***

### getTimestamp()

```ts
getTimestamp(): Date
```

Defined in: node\_modules/bson/bson.d.ts:1418

Returns the generation date (accurate up to the second) that this ID was generated.

#### Returns

`Date`

***

### inspect()

```ts
inspect(
   depth?, 
   options?, 
   inspect?): string
```

Defined in: node\_modules/bson/bson.d.ts:1448

Converts to a string representation of this Id.

#### Parameters

##### depth?

`number`

##### options?

`unknown`

##### inspect?

`InspectFn`

#### Returns

`string`

return the 24 character hex string representation.

#### Overrides

```ts
BSONValue.inspect
```

***

### isValid()

```ts
static isValid(id): boolean
```

Defined in: node\_modules/bson/bson.d.ts:1439

Checks if a value can be used to create a valid bson ObjectId

#### Parameters

##### id

any JS value

`string` | `number` | `Uint8Array` | [`ObjectId`](/docs/api-reference/server/classes/ObjectId.md) | `ObjectIdLike`

#### Returns

`boolean`

***

### toHexString()

```ts
toHexString(): string
```

Defined in: node\_modules/bson/bson.d.ts:1395

Returns the ObjectId id as a 24 lowercase character hex string representation

#### Returns

`string`

***

### toJSON()

```ts
toJSON(): string
```

Defined in: node\_modules/bson/bson.d.ts:1409

Converts to its JSON the 24 character hex string representation.

#### Returns

`string`

***

### toString()

```ts
toString(encoding?): string
```

Defined in: node\_modules/bson/bson.d.ts:1407

Converts the id into a 24 character hex string for printing, unless encoding is provided.

#### Parameters

##### encoding?

hex or base64

`"base64"` | `"hex"`

#### Returns

`string`

## Properties

### cacheHexString

```ts
static cacheHexString: boolean;
```

Defined in: node\_modules/bson/bson.d.ts:1346
