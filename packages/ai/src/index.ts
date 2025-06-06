import { getConfig } from 'modelence/server';

export function getOpenAIConfig() {
  return {
    apiKey: String(getConfig('_system.openai.apiKey'))
  };
}
