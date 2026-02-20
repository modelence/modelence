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
type ModelenceGenerateTextOptions<T> = T extends unknown
  ? Omit<T, 'model'> & {
      provider: Provider;
      model: string;
    }
  : never;

/**
 * Options for the Modelence generateText function.
 * 
 * This type extends all the standard AI SDK generateText options,
 * but replaces the model parameter with separate provider and model parameters.
 */
export type GenerateTextOptions = ModelenceGenerateTextOptions<OriginalGenerateTextParams>;

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
        apiKey: String(getConfig('_system.gemini.apiKey')),
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
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-6',
 *   messages: [
 *     { role: 'user', content: 'Write a haiku about programming' }
 *   ],
 *   temperature: 0.7
 * });
 * 
 * console.log(response.text);
 * ```
 */
export async function generateText(
  options: GenerateTextOptions
): Promise<Awaited<ReturnType<typeof originalGenerateText>>> {
  const { provider, model, ...restOptions } = options;
  
  const transaction = startTransaction('ai', 'ai:generateText', {
    provider, 
    model,
    messageCount: Array.isArray(options.messages) ? options.messages.length : 0,
    temperature: options.temperature
  });

  try {
    const providerModel = getProviderModel(provider, model);
    const result = await originalGenerateText({
      ...restOptions,
      model: providerModel,
    });
    const usage = result.usage as {
      inputTokens?: number;
      outputTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    
    if ('setContext' in transaction) {
      transaction.end('success', {
        context: {
          usage: {
            promptTokens: usage.inputTokens ?? usage.promptTokens,
            completionTokens: usage.outputTokens ?? usage.completionTokens,
            totalTokens: usage.totalTokens,
          }
        }
      });
    } else {
      // Backwards compatibility for older versions of Modelence
      // @ts-ignore
      transaction.end('success');
    }
    return result;
  } catch (error) {
    captureError(error as Error);
    transaction.end('error');
    throw error;
  }
}
