import { WebsocketServerProvider } from '@/websocket/types';

export type WebsocketConfig = {
  /**
   * Whether to start the WebSocket server. Defaults to `true`.
   *
   * Set to `false` for apps that use neither live queries nor channels: no
   * WebSocket server is attached to the HTTP server, so its endpoint is not
   * exposed at all. When disabled, `provider` is ignored.
   *
   * @example
   * ```typescript
   * startApp({
   *   websocket: { enabled: false },
   * });
   * ```
   */
  enabled?: boolean;
  provider?: WebsocketServerProvider;
};

let websocketConfig: WebsocketConfig = Object.freeze({});

export function setWebsocketConfig(newWebsocketConfig: WebsocketConfig) {
  websocketConfig = Object.freeze(Object.assign({}, websocketConfig, newWebsocketConfig));
}

export function getWebsocketConfig() {
  return websocketConfig;
}
