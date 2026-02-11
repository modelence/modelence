import { create } from 'zustand';
import { z } from 'zod';
import { callMethod } from './method';
import { _setConfig } from '../config/client';
import { setLocalStorageSession } from './localStorage';
import { time } from '../time';
import { Configs } from '../config/types';

type User = {
  id: string;
  handle: string;
  roles: string[];
  hasRole: (role: string) => boolean;
  requireRole: (role: string) => void;
  name?: string;
  picture?: string;
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
const SESSION_HEARTBEAT_INTERVAL = time.seconds(30);
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

const userSchema = z.object({
  id: z.string(),
  handle: z.string(),
  roles: z.array(z.string()),
  name: z.string().optional(),
  picture: z.string().optional(),
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
    name: parsedData.name ?? undefined,
    picture: parsedData.picture ?? undefined,
    hasRole: (role: string) => parsedData.roles.includes(role),
    requireRole: (role: string) => {
      if (!parsedData.roles.includes(role)) {
        throw new Error(`Access denied - role '${role}' required`);
      }
    },
  });
}

export async function initSession() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  const { configs, session, user } = await callMethod<{
    configs: Configs;
    session: object;
    user: object;
  }>('_system.session.init');
  _setConfig(configs);
  setLocalStorageSession(session);

  useSessionStore.getState().setUser(parseUser(user));

  await loopSessionHeartbeat();
}

async function loopSessionHeartbeat() {
  try {
    await callMethod('_system.session.heartbeat', {}, { errorHandler: () => { } });
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

export function getHeartbeatTimer() {
  return heartbeatTimer;
}

export function stopHeartbeatTimer() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
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
  const user = useSessionStore((state) => state.user);
  return { user };
}
