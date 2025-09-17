import { WebsocketClientProvider } from "./types";

let websocketClientProvider: WebsocketClientProvider | null = null;

export function setWebsocketClientProvider(provider: WebsocketClientProvider) {
  websocketClientProvider = provider;
}

export function getWebsocketClientProvider() {
  return websocketClientProvider;
}
