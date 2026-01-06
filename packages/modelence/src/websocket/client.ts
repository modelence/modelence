import { ClientChannel } from './clientChannel';
import websocketProvider, { subscribeLiveQuery } from './socketio/client';
import { WebsocketClientProvider } from './types';

export { subscribeLiveQuery };

let websocketClientProvider: WebsocketClientProvider | null = null;

export function setWebsocketClientProvider(provider: WebsocketClientProvider) {
  websocketClientProvider = provider;
}

export function getWebsocketClientProvider() {
  return websocketClientProvider;
}

export function startWebsockets(props?: {
  provider?: WebsocketClientProvider;
  channels?: ClientChannel[];
}) {
  if (websocketClientProvider) {
    console.warn('WebSocket already initialized. Skipping initialization.');
    return;
  }

  const provider = props?.provider || websocketProvider;
  provider.init({
    channels: props?.channels,
  });
  setWebsocketClientProvider(provider);
}
