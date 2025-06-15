import { getConfig } from 'modelence/server';
import { startTransaction, captureError } from 'modelence/telemetry';
import { generateText as originalGenerateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Supported AI providers for text generation.
 */
type Provider = 'openai' | 'anthropic' | 'google';

// Extract the original generateText parameters and override the model property
type OriginalGenerateTextParams = Parameters<typeof originalGenerateText>[0];

/**
 * Options for the Modelence generateText function.
 * 
 * This interface extends all the standard AI SDK generateText options,
 * but replaces the model parameter with separate provider and model parameters.
 */
export interface GenerateTextOptions extends Omit<OriginalGenerateTextParams, 'model'> {
  /** The AI provider name */
  provider: Provider;
  /** The specific model name */
  model: string;
}

function getProviderModel(provider: Provider, model: string) {
  switch (provider) {
    case 'openai':
      return createOpenAI({
        apiKey: String(getConfig('_system.openai.apiKey')),
      })(model);
    
    case 'anthropic':
      return createAnthropic({
        apiKey: String(getConfig('_system.anthropic.apiKey')),
      })(model);
    
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: String(getConfig('_system.google.apiKey')),
      })(model);
    
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Generates text using AI models with built-in Modelence configuration and telemetry.
 * 
 * This is a wrapper around the AI SDK's generateText function that automatically
 * configures providers using Modelence's server-side configuration system.
 * 
 * @param options - Configuration options for text generation
 * @returns A promise that resolves to the generated text result
 * 
 * @example
 * ```typescript
 * import { generateText } from '@modelence/ai';
 * 
 * const response = await generateText({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   messages: [
 *     { role: 'user', content: 'Write a haiku about programming' }
 *   ],
 *   temperature: 0.7
 * });
 * 
 * console.log(response.text);
 * ```
 */
export async function generateText(options: GenerateTextOptions) {
  const { provider, model, ...restOptions } = options;
  
  const transaction = startTransaction('ai', 'ai:generateText', {
    provider, 
    model,
    messageCount: Array.isArray(options.messages) ? options.messages.length : 0,
    temperature: options.temperature
  });

  try {
    const result = await originalGenerateText({
      model: getProviderModel(provider, model),
      ...restOptions,
    });
    
    transaction.end();
    return result;
  } catch (error) {
    captureError(error as Error);
    transaction.end('error');
    throw error;
  }
}
