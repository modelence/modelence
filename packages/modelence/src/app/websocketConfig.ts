import { WebsocketServerProvider } from '@/websocket/types';

export type WebsocketConfig = {
  provider?: WebsocketServerProvider;
};

let websocketConfig: WebsocketConfig = Object.freeze({});

export function setWebsocketConfig(newWebsocketConfig: WebsocketConfig) {
  websocketConfig = Object.freeze(Object.assign({}, websocketConfig, newWebsocketConfig));
}

export function getWebsocketConfig() {
  return websocketConfig;
}
