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

  const parsedUser = user
    ? Object.freeze({
        ...z
          .object({
            id: z.string(),
            handle: z.string(),
            roles: z.array(z.string()),
          })
          .parse(user),
        hasRole: (role: string) => (user as any).roles?.includes(role) ?? false,
        requireRole: (role: string) => {
          if (!(user as any).roles?.includes(role)) {
            throw new Error(`Access denied - role '${role}' required`);
          }
        },
      })
    : null;

  useSessionStore.getState().setUser(parsedUser);

  await loopSessionHeartbeat();
}

async function loopSessionHeartbeat() {
  await callMethod('_system.session.heartbeat');
  setTimeout(loopSessionHeartbeat, SESSION_HEARTBEAT_INTERVAL);
}

export function setCurrentUser(user: User | null) {
  useSessionStore.getState().setUser(user);
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

