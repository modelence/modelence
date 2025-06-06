import { getConfig } from '../config/server';

export function getOpenAIConfig() {
  return {
    apiKey: String(getConfig('_system.openai.apiKey'))
  };
}
