import { create } from 'zustand';
import { z } from 'zod';
import { callMethod } from './method';
import { _setConfig } from '../config/client';
import { getLocalStorageSession, setLocalStorageSession } from './localStorage';
import { getClientConfig } from './clientConfig';
import { time } from '../time';
import { Configs } from '../config/types';

type User = {
  id: string;
  handle: string;
  roles: string[];
  hasRole: (role: string) => boolean;
  requireRole: (role: string) => void;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

type SessionStore = {
  user: User | null;
  setUser: (user: User | null) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));

let isInitialized = false;
// Set when SSR rendered anonymously but localStorage holds a token (no
// cookie yet). `reconcileSession()` then re-auths via the body and refreshes
// the cookie for subsequent SSR requests.
let pendingReconciliation = false;
const SESSION_HEARTBEAT_INTERVAL = time.seconds(30);
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

const userSchema = z.object({
  id: z.string(),
  handle: z.string(),
  roles: z.array(z.string()),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  avatarUrl: z.string().optional(),
});

function parseUser(user: unknown): User | null {
  if (!user) {
    return null;
  }

  const result = userSchema.safeParse(user);

  if (!result.success) {
    console.error('Session Error: Invalid user payload', result.error);
    return null;
  }

  const parsedData = result.data;

  return Object.freeze({
    ...parsedData,
    firstName: parsedData.firstName ?? undefined,
    lastName: parsedData.lastName ?? undefined,
    avatarUrl: parsedData.avatarUrl ?? undefined,
    hasRole: (role: string) => parsedData.roles.includes(role),
    requireRole: (role: string) => {
      if (!parsedData.roles.includes(role)) {
        throw new Error(`Access denied - role '${role}' required`);
      }
    },
  });
}

export type SessionInitPayload = {
  configs: Configs;
  session: object & { authToken: string };
  user: object;
};

/** Hydrate session state from the SSR payload, skipping the network round-trip. */
export function hydrateSession(payload: SessionInitPayload) {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  _setConfig(payload.configs);

  // localStorage token + anonymous SSR payload = server couldn't read the
  // token (no cookie yet). Preserve the localStorage token and defer to
  // `reconcileSession()`; overwriting here would log the user out permanently.
  const existingLocalSession = getLocalStorageSession() as { authToken?: string } | null;
  const existingToken = existingLocalSession?.authToken;
  const ssrSession = payload.session as { authToken?: string };

  if (existingToken && !payload.user && existingToken !== ssrSession.authToken) {
    pendingReconciliation = true;
    // First render must match the server (anonymous); reconcile swaps later.
    useSessionStore.getState().setUser(parseUser(payload.user));
    return;
  }

  setLocalStorageSession(payload.session);
  useSessionStore.getState().setUser(parseUser(payload.user));
}

/** Re-auth via the body token when SSR couldn't read it from a cookie. */
export async function reconcileSession() {
  if (!pendingReconciliation) {
    return;
  }
  pendingReconciliation = false;

  try {
    const { configs, session, user } = await callMethod<SessionInitPayload>('_system.session.init');
    _setConfig(configs);
    setLocalStorageSession(session);
    useSessionStore.getState().setUser(parseUser(user));
  } catch (error) {
    console.error('Modelence: session reconciliation failed', error);
  }
}

/** @internal */
export function _isReconciliationPending(): boolean {
  return pendingReconciliation;
}

export async function initSession() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  const { configs, session, user } = await callMethod<SessionInitPayload>('_system.session.init');
  _setConfig(configs);

  const config = getClientConfig();
  if (config) {
    config.setAuthToken(session.authToken);
  } else {
    setLocalStorageSession(session);
  }

  useSessionStore.getState().setUser(parseUser(user));

  await loopSessionHeartbeat();
}

/** Idempotent, client-only. Auto-started by `initSession`; call explicitly after `hydrateSession`. */
export async function startSessionHeartbeat() {
  if (typeof window === 'undefined' || heartbeatTimer !== null) {
    return;
  }
  await loopSessionHeartbeat();
}

async function loopSessionHeartbeat() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    await callMethod('_system.session.heartbeat', {}, { errorHandler: () => {} });
  } catch {
    // Silently ignore heartbeat errors - they're expected during HMR/reconnects
  }
  heartbeatTimer = setTimeout(loopSessionHeartbeat, SESSION_HEARTBEAT_INTERVAL);
}

export function setCurrentUser(user: unknown) {
  const enrichedUser = parseUser(user);
  useSessionStore.getState().setUser(enrichedUser);
  return enrichedUser;
}

export function isSessionInitialized() {
  return isInitialized;
}

export function getHeartbeatTimer() {
  return heartbeatTimer;
}

export function stopHeartbeatTimer() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

type SsrSessionResolver = () => User | null;
let ssrSessionResolver: SsrSessionResolver | null = null;

/** @internal SSR resolver reads from AsyncLocalStorage (per-request scoped). */
export function _setSsrSessionResolver(resolver: SsrSessionResolver | null) {
  ssrSessionResolver = resolver;
}

/** @internal */
export function _parseSessionUser(user: unknown): User | null {
  return parseUser(user);
}

/**
 * `useSession` is a hook that returns the current user, and in the future will also return other details about the current session.
 *
 * @example
 * ```ts
 * import { useSession } from 'modelence/client';
 *
 * function MyComponent() {
 *   const { user } = useSession();
 *   return <div>{user?.handle}</div>;
 * }
 * ```
 */
export function useSession() {
  if (typeof window === 'undefined' && ssrSessionResolver) {
    return { user: ssrSessionResolver() };
  }
  const user = useSessionStore((state) => state.user);
  return { user };
}
