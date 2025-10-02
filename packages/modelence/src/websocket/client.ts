import { ClientChannel } from "./clientChannel";
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
  channels?: ClientChannel[],
}) {
  const provider = props?.provider || websocketProvider;
  provider.init({
    channels: props?.channels,
  });
  setWebsocketClientProvider(provider);
}
