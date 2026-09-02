import type { ClientInfo } from '@/methods/types';

/**
 * What `openUrl` may return. A `Window` (from `window.open`) enables the popup
 * handoff described on {@link ClientConfig.openUrl}; anything else — including
 * the `Promise` from `Linking.openURL` — is accepted and ignored.
 */
export type OpenUrlResult = void | Window | null | Promise<unknown>;

export interface ClientConfig {
  baseUrl: string;
  getAuthToken: () => string | undefined;
  setAuthToken: (token: string | null) => void;
  getClientInfo: () => ClientInfo;
  /**
   * Opens a URL for OAuth redirects. React Native must use
   * `(url) => Linking.openURL(url)` — WebView is not supported.
   * Defaults to `window.location.href` when not provided.
   *
   * A web client that opens the flow in a popup should return the window
   * `window.open` gave it: `(url) => window.open(url)`. With that reference the
   * callback page in the popup can obtain the sign-in verifier from this page
   * directly, which is what makes `loginWithOAuth` work when the app itself
   * runs inside a cross-origin iframe and the popup's storage is partitioned
   * away from it. Any other return value is ignored.
   */
  openUrl?: (url: string) => OpenUrlResult;
  /**
   * Credentials mode for method-call requests. Defaults to `'include'`, which
   * browser apps need for the cookie-based flows (password reset, magic link).
   *
   * Clients configured with token-in-body auth (React Native / Expo) never use
   * cookies, so set `'omit'` there — on Expo Web a credentialed cross-origin
   * request is otherwise blocked by any server answering
   * `Access-Control-Allow-Origin: *`, surfacing as "TypeError: Failed to fetch".
   */
  credentials?: RequestCredentials;
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
