import type { ClientInfo } from '@/methods/types';

export interface ClientConfig {
  baseUrl: string;
  getAuthToken: () => string | undefined;
  setAuthToken: (token: string | null) => void;
  getClientInfo: () => ClientInfo;
  /**
   * Opens a URL for OAuth redirects. React Native must use
   * `(url) => Linking.openURL(url)` — WebView is not supported.
   * Defaults to `window.location.href` when not provided.
   */
  openUrl?: (url: string) => void;
}

let config: ClientConfig | null = null;

/**
 * Configure the Modelence client for non-browser environments like React Native.
 *
 * When configured, the client uses the provided functions for auth-token
 * storage, client-info collection, and URL resolution instead of the
 * default browser APIs (localStorage, window.screen, relative URLs).
 *
 * @example
 * ```ts
 * import { configureClient } from 'modelence/client';
 * import { Linking } from 'react-native';
 *
 * let authToken: string | undefined;
 *
 * configureClient({
 *   baseUrl: 'https://myapp.com',
 *   getAuthToken: () => authToken,
 *   setAuthToken: (token) => { authToken = token ?? undefined; },
 *   getClientInfo: () => ({
 *     screenWidth: Dimensions.get('screen').width,
 *     screenHeight: Dimensions.get('screen').height,
 *     windowWidth: Dimensions.get('window').width,
 *     windowHeight: Dimensions.get('window').height,
 *     pixelRatio: PixelRatio.get(),
 *     orientation: null,
 *   }),
 *   openUrl: (url) => Linking.openURL(url),
 * });
 * ```
 */
export function configureClient(userConfig: ClientConfig) {
  config = userConfig;
}

export function getClientConfig(): ClientConfig | null {
  return config;
}
