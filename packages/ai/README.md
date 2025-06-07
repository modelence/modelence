# @modelence/ai

AI engine for Modelence applications with built-in telemetry, based on https://ai-sdk.dev

## Installation

```bash
npm install @modelence/ai
```

## Usage

### generateText

A wrapper around [AI SDK](https://ai-sdk.dev)'s `generateText` with built-in Modelence configuration and telemetry.

```typescript
import { generateText } from '@modelence/ai';

const response = await generateText({
  provider: 'openai',
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Hello, world!' }
  ],
});

console.log(response.text);
```

#### Supported Providers

- **OpenAI**: `provider: 'openai'`, models: `gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo`
- **Anthropic**: `provider: 'anthropic'`, models: `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`
- **Google**: `provider: 'google'`, models: `gemini-1.5-pro`, `gemini-1.5-flash`

#### Configuration

The function automatically uses API keys from Modelence configuration:
- OpenAI: `_system.openai.apiKey`
- Anthropic: `_system.anthropic.apiKey`
- Google: `_system.google.apiKey`

You don't need to manually set any of these configs as long as your application is using a [Modelence Cloud](https://modelence.com/cloud) backend - simply use the AI > Integrations tab in your Modelence Cloud dashboard to configure keys, and it will be automatically used and recognized by this package.
