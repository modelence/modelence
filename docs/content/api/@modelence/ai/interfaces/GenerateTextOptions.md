# Interface: GenerateTextOptions

Defined in: [index.ts:22](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/ai/src/index.ts#L22)

Options for the Modelence generateText function.

This interface extends all the standard AI SDK generateText options,
but replaces the model parameter with separate provider and model parameters.

## Extends

- `Omit`\<`OriginalGenerateTextParams`, `"model"`\>

## Properties

### model

```ts
model: string;
```

Defined in: [index.ts:26](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/ai/src/index.ts#L26)

The specific model name

***

### provider

```ts
provider: Provider;
```

Defined in: [index.ts:24](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/ai/src/index.ts#L24)

The AI provider name
