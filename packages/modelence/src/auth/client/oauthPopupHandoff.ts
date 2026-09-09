/**
 * Code handoff from the popup that finishes an OAuth flow to the page that
 * started it.
 *
 * The `sessionStorage` mirror in `oauthVerifier.ts` covers a same-tab redirect.
 * It does not cover an app running inside a cross-origin iframe (an embedded
 * preview or sandbox) whose `openUrl` opens the provider in a real popup —
 * which it must, since providers refuse to render their consent screen in an
 * iframe. Once the popup is a genuine top-level browsing context, its storage
 * is partitioned away from the iframe's (Chrome storage partitioning, Safari
 * ITP), so the callback page in the popup shares nothing with the iframe.
 *
 * The direction of the handoff decides where the user ends up signed in. The
 * popup could ask for the verifier and redeem the code itself, but then the
 * session it establishes lives in the popup — whose storage is partitioned and
 * which is about to close — and the iframe, the context the app actually runs
 * in, stays signed out. So the code travels the other way: the popup hands the
 * short-lived, single-use exchange code to its opener, and the opener, which
 * already holds the verifier, redeems it and completes the login in its own
 * context. The verifier never leaves the page that minted it.
 *
 * Identity on both sides is the window reference itself (`event.source`). A
 * `WindowProxy` reference cannot be forged or aliased by another frame: the
 * opener compares against the exact object `window.open` returned, and the
 * popup against its own `window.opener`. That identity survives the popup's
 * navigation to the provider and back, because a same-origin history traversal
 * reuses the browsing context's proxy rather than creating a new one. Hence the
 * messages carry no nonce — a nonce would authenticate the *message*, but what
 * needs authenticating is the *peer*, and the window reference already does
 * that strictly better than a shared secret could (it is unguessable, unique,
 * and cannot be replayed by a third party who observed it). Origin is checked
 * in addition, so a navigation away from the app's origin cannot be answered.
 *
 * The channel is exactly as trusted as the tab that called `signInWithOAuth`:
 * nothing weaker (no `localStorage`, no URL) is used, and no session token
 * crosses it — only the exchange code, which is useless without the verifier
 * held privately in the opener.
 */

const CODE_TYPE = 'modelence:oauth-code';
const CODE_ACK_TYPE = 'modelence:oauth-code-ack';

/**
 * How long the popup waits for the opener to acknowledge the code before
 * giving up and finishing the flow itself. A live opener acknowledges in a
 * single event-loop turn; the timeout only matters when the opener is gone or
 * is some unrelated page that will never answer.
 */
const ACK_TIMEOUT_MS = 3000;

interface CodeMessage {
  type: typeof CODE_TYPE;
  code: string;
}

interface CodeAck {
  type: typeof CODE_ACK_TYPE;
  /** Whether the opener accepted responsibility for redeeming the code. */
  accepted: boolean;
}

/** The subset of `window` both sides need; keeps tests free of a DOM. */
export interface HandoffWindow {
  location: { origin: string };
  opener?: unknown;
  /** Browsing-context name; set by the opener via `window.open`. */
  name?: string;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
}

/** The subset of a `Window` reference used to talk to the other side. */
export interface MessageTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
  /** Present on a real popup window; used to close it once the code is in. */
  close?: () => void;
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

function isCodeMessage(data: unknown): data is CodeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<CodeMessage>;
  return d.type === CODE_TYPE && typeof d.code === 'string' && d.code.length > 0;
}

function isCodeAck(data: unknown): data is CodeAck {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<CodeAck>;
  return d.type === CODE_ACK_TYPE && typeof d.accepted === 'boolean';
}

/** Tears down the listener of the most recent `awaitCodeFromPopup`. */
let cancelActiveOffer: (() => void) | null = null;

/**
 * Opener side. Waits for `popup` — the exact reference `window.open` returned —
 * to deliver the exchange code, then completes the sign-in here.
 *
 * `completeLogin` is invoked at most once: the listener is removed before it
 * runs, so a popup that posts twice cannot start two redemptions. Only the most
 * recent flow is live; starting another replaces it, matching how
 * `startOAuthVerifier` discards the previous verifier.
 *
 * Errors from `completeLogin` are reported to `onError` rather than thrown,
 * since this runs in an event listener where nothing would catch them. The
 * popup is closed once the code has been accepted, whether or not redemption
 * then succeeds — the code is single-use and the popup has no further part to
 * play either way.
 */
export function awaitCodeFromPopup(
  popup: MessageTarget,
  completeLogin: (code: string) => Promise<unknown>,
  onError?: (error: unknown) => void
): void {
  cancelPopupHandoff();

  const w = getWindow();
  if (!w) return;

  const origin = w.location.origin;

  const onMessage = (event: MessageEvent) => {
    // Identity first: the message must come from the window we opened, not
    // merely from something that knows the message shape. Any other frame or
    // tab on this origin could otherwise feed us a code of its choosing.
    if (event.source !== popup) return;
    if (event.origin !== origin) return;
    if (!isCodeMessage(event.data)) return;

    cancelPopupHandoff();

    const { code } = event.data;

    // Acknowledge before redeeming: the popup only needs to know that someone
    // else owns the code now, so it can stop waiting and stay out of the way.
    const ack: CodeAck = { type: CODE_ACK_TYPE, accepted: true };
    // Explicit target origin: if the popup has since navigated elsewhere, the
    // browser drops the message rather than delivering it to a foreign page.
    try {
      popup.postMessage(ack, origin);
    } catch {
      // The popup may already be gone; redemption does not depend on it.
    }

    void Promise.resolve()
      .then(() => completeLogin(code))
      .catch((error) => onError?.(error))
      .finally(() => closePopup(popup));
  };

  w.addEventListener('message', onMessage);
  cancelActiveOffer = () => w.removeEventListener('message', onMessage);
}

/** Closes the popup, ignoring the cross-origin or already-closed cases. */
function closePopup(popup: MessageTarget): void {
  try {
    popup.close?.();
  } catch {
    // Not ours to close any more; the user can close it themselves.
  }
}

/** Stops listening for a popup's code. Safe to call when nothing is pending. */
export function cancelPopupHandoff(): void {
  cancelActiveOffer?.();
  cancelActiveOffer = null;
}

/**
 * Popup side. Hands the exchange code to `window.opener` and reports whether
 * the opener took ownership of it.
 *
 * Resolves `true` only on an explicit acceptance, which means the opener is
 * redeeming the code and this page must not. Resolves `false` when there is no
 * opener, when the opener never answers (it is not a Modelence page, is on
 * another origin, or its `opener` link was severed by
 * `Cross-Origin-Opener-Policy`), or when it declines — in each of those cases
 * the caller falls back to finishing the flow in this context.
 */
export function offerCodeToOpener(code: string): Promise<boolean> {
  const w = getWindow();
  const opener = w?.opener;
  if (!w || !isMessageTarget(opener)) return Promise.resolve(false);

  const origin = w.location.origin;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(accepted);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener) return;
      if (event.origin !== origin) return;
      if (!isCodeAck(event.data)) return;
      finish(event.data.accepted);
    };

    const timer = setTimeout(() => finish(false), ACK_TIMEOUT_MS);
    w.addEventListener('message', onMessage);

    const message: CodeMessage = { type: CODE_TYPE, code };
    try {
      // Explicit target origin: a cross-origin opener never receives this.
      opener.postMessage(message, origin);
    } catch {
      finish(false);
    }
  });
}

/**
 * The browsing-context name `signInWithOAuth` gives a popup it opens.
 *
 * Cosmetic, and lets `resumeOAuthPopup` reclaim the window by name. It is NOT
 * an identity signal across the provider round trip: a
 * `Cross-Origin-Opener-Policy: same-origin` response puts the page in a fresh
 * browsing context group, which clears `window.name` along with
 * `window.opener`. Verified in Chrome against a server sending real COOP: after
 * the hop the callback page sees `name === ''` and `opener === null`.
 */
export const OAUTH_POPUP_NAME = 'modelence-oauth';
