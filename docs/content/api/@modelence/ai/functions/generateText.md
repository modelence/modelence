# Function: generateText()

```ts
function generateText(options): Promise<GenerateTextResult<ToolSet, unknown>>;
```

Defined in: [index.ts:76](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/ai/src/index.ts#L76)

Generates text using AI models with built-in Modelence configuration and telemetry.

This is a wrapper around the AI SDK's generateText function that automatically
configures providers using Modelence's server-side configuration system.

## Parameters

### options

[`GenerateTextOptions`](/docs/api-reference/@modelence/ai/interfaces/GenerateTextOptions.md)

Configuration options for text generation

## Returns

`Promise`\<`GenerateTextResult`\<`ToolSet`, `unknown`\>\>

A promise that resolves to the generated text result

## Example

```typescript
import { generateText } from '@modelence/ai';

const response = await generateText({
  provider: 'openai',
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Write a haiku about programming' }
  ],
  temperature: 0.7
});

console.log(response.text);
```
