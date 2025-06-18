# @modelence/ai

Unified LLM integration and telemetry for Modelence applications, powered by [AI SDK](https://ai-sdk.dev).

## Installation

```bash
npm install @modelence/ai
```

## Overview

This package provides a single `generateText` function to access OpenAI, Anthropic, and Google Gemini models with built-in Modelence configuration and observability. API keys are managed automatically via Modelence Cloud, and all calls are traced for full AI observability.

All properties from [AI SDK](https://ai-sdk.dev)'s `generateText` are supported.

## Usage

### Basic Text Generation

```ts
import { generateText } from '@modelence/ai';

const response = await generateText({
  provider: 'openai',
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Write a haiku about programming.' }
  ],
  temperature: 0.7
});

console.log(response.text);
```

### Supported Providers & Models

- **OpenAI**: `provider: 'openai'` — `gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo`
- **Anthropic**: `provider: 'anthropic'` — `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`
- **Google**: `provider: 'google'` — `gemini-1.5-pro`, `gemini-1.5-flash`

### Configuration

API keys are automatically loaded from your Modelence Cloud configuration:
- OpenAI: `_system.openai.apiKey`
- Anthropic: `_system.anthropic.apiKey`
- Google: `_system.google.apiKey`

No manual setup is required - just configure your keys in the Modelence Cloud dashboard (AI > Integrations tab).

## Interfaces

- [GenerateTextOptions](/docs/api-reference/@modelence/ai/interfaces/GenerateTextOptions.md)

## Functions

- [generateText](/docs/api-reference/@modelence/ai/functions/generateText.md)
