import websocketProvider from "./socketio/client";
import { WebsocketClientProvider } from "./types";

let websocketClientProvider: WebsocketClientProvider | null = null;

export function setWebsocketClientProvider(provider: WebsocketClientProvider) {
  websocketClientProvider = provider;
}

export function getWebsocketClientProvider() {
  return websocketClientProvider;
}

export function startWebsockets(props?: {
  provider?: WebsocketClientProvider,
}) {
  setWebsocketClientProvider(props?.provider || websocketProvider);
}
