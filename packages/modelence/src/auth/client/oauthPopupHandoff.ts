/**
 * Verifier handoff from the page that started an OAuth flow to the popup that
 * finishes it.
 *
 * The `sessionStorage` mirror in `oauthVerifier.ts` covers a same-tab redirect.
 * It does not cover an app running inside a cross-origin iframe (an embedded
 * preview or sandbox) whose `openUrl` opens the provider in a real popup —
 * which it must, since providers refuse to render their consent screen in an
 * iframe. Once the popup is a genuine top-level browsing context, its storage
 * is partitioned away from the iframe's (Chrome storage partitioning, Safari
 * ITP), so the callback page cannot read the verifier the iframe wrote.
 *
 * The verifier still lives in memory on the page that minted it, and that page
 * holds the `Window` reference `window.open` returned. So the callback page
 * asks its opener for the verifier over `postMessage`, and the opener answers
 * only that popup, only on its own origin, only once. The channel is exactly as
 * trusted as the tab that called `signInWithOAuth`: no more than the in-memory
 * copy it serves, and nothing weaker (no `localStorage`, no URL) is used.
 */

import { randomHex } from './randomHex';

const REQUEST_TYPE = 'modelence:oauth-verifier-request';
const REPLY_TYPE = 'modelence:oauth-verifier-reply';

/**
 * How long the callback page waits for its opener before falling back to
 * storage. A live opener answers in a single event-loop turn; the timeout only
 * matters when the opener is some unrelated page that will never answer.
 */
const REPLY_TIMEOUT_MS = 3000;

/** Nonce length in bytes. Correlates one request with its reply, nothing more. */
const NONCE_BYTES = 16;

interface VerifierRequest {
  type: typeof REQUEST_TYPE;
  nonce: string;
}

interface VerifierReply {
  type: typeof REPLY_TYPE;
  nonce: string;
  verifier: string | null;
}

/** The subset of `window` both sides need; keeps tests free of a DOM. */
export interface HandoffWindow {
  location: { origin: string };
  opener?: unknown;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
}

/** The subset of a `Window` reference used to talk to the other side. */
export interface MessageTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

function getWindow(): HandoffWindow | null {
  const w = (globalThis as { window?: unknown }).window;
  return isHandoffWindow(w) ? w : null;
}

function isHandoffWindow(value: unknown): value is HandoffWindow {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Partial<HandoffWindow>;
  return (
    typeof w.addEventListener === 'function' &&
    typeof w.removeEventListener === 'function' &&
    typeof w.location?.origin === 'string'
  );
}

/**
 * Whether `openUrl` handed back a window reference — the return value of
 * `window.open`. A `Promise` (React Native's `Linking.openURL`) or `undefined`
 * is not one, so those clients are unaffected.
 */
export function isMessageTarget(value: unknown): value is MessageTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<MessageTarget>).postMessage === 'function'
  );
}

function isVerifierRequest(data: unknown): data is VerifierRequest {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<VerifierRequest>;
  return d.type === REQUEST_TYPE && typeof d.nonce === 'string';
}

function isVerifierReply(data: unknown): data is VerifierReply {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<VerifierReply>;
  return (
    d.type === REPLY_TYPE &&
    typeof d.nonce === 'string' &&
    (typeof d.verifier === 'string' || d.verifier === null)
  );
}

/** Tears down the listener of the most recent `offerVerifierToPopup`. */
let cancelActiveOffer: (() => void) | null = null;

/**
 * Opener side. Serves the pending verifier to `popup` — the exact reference
 * `window.open` returned — and to nothing else.
 *
 * `takeVerifier` is consulted only when a valid request arrives, and the
 * listener is removed as soon as it has answered, so the verifier is handed
 * out at most once. Only the most recent offer is live: starting another flow
 * replaces it, matching how `startOAuthVerifier` discards the previous
 * verifier.
 */
export function offerVerifierToPopup(
  popup: MessageTarget,
  takeVerifier: () => string | null
): void {
  cancelPopupHandoff();

  const w = getWindow();
  if (!w) return;

  const origin = w.location.origin;

  const onMessage = (event: MessageEvent) => {
    // Identity first: the message must come from the window we opened, not
    // merely from something that knows the message shape. Any other frame or
    // tab on this origin could otherwise probe for the verifier.
    if (event.source !== popup) return;
    if (event.origin !== origin) return;
    if (!isVerifierRequest(event.data)) return;

    cancelPopupHandoff();

    const reply: VerifierReply = {
      type: REPLY_TYPE,
      nonce: event.data.nonce,
      verifier: takeVerifier(),
    };
    // Explicit target origin: if the popup has since navigated elsewhere, the
    // browser drops the message rather than delivering it to a foreign page.
    popup.postMessage(reply, origin);
  };

  w.addEventListener('message', onMessage);
  cancelActiveOffer = () => w.removeEventListener('message', onMessage);
}

/** Stops answering popup requests. Safe to call when nothing is offered. */
export function cancelPopupHandoff(): void {
  cancelActiveOffer?.();
  cancelActiveOffer = null;
}

/**
 * Popup side. Asks `window.opener` for the verifier of the flow it started.
 *
 * Resolves with `null` when there is no opener, the opener never answers
 * (it is not a Modelence page, or is on another origin), or it has nothing
 * left to give. Callers fall back to their own storage in every such case, so
 * a flow that did not go through a popup is unaffected.
 */
export function requestVerifierFromOpener(): Promise<string | null> {
  const w = getWindow();
  const opener = w?.opener;
  if (!w || !isMessageTarget(opener)) return Promise.resolve(null);

  const origin = w.location.origin;
  const nonce = randomHex(NONCE_BYTES);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (verifier: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(verifier);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener) return;
      if (event.origin !== origin) return;
      if (!isVerifierReply(event.data) || event.data.nonce !== nonce) return;
      finish(event.data.verifier);
    };

    const timer = setTimeout(() => finish(null), REPLY_TIMEOUT_MS);
    w.addEventListener('message', onMessage);

    const request: VerifierRequest = { type: REQUEST_TYPE, nonce };
    try {
      // Explicit target origin: a cross-origin opener never receives this.
      opener.postMessage(request, origin);
    } catch {
      finish(null);
    }
  });
}
