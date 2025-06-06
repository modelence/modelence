# @modelence/ai

AI engine for Modelence applications.

## Installation

```bash
npm install @modelence/ai
```

## Usage

```typescript
import { getOpenAIConfig } from '@modelence/ai';

const config = getOpenAIConfig();
// Returns: { apiKey: string }
```

## Functions

### `getOpenAIConfig()`

Returns the OpenAI configuration from Modelence server config.

**Returns:** `{ apiKey: string }`

The API key is retrieved from the `_system.openai.apiKey` configuration key using Modelence's server-side config system.
