'use client';

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

  const { configs, session, user } = await callMethod<{ configs: Configs, session: object, user: object }>('_system.session.init');
  _setConfig(configs);
  setLocalStorageSession(session);
  
  const parsedUser = user ? Object.freeze(z.object({
    id: z.string(),
    handle: z.string(),
  }).parse(user)) : null;

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

export function useSession() {
  const user = useSessionStore(state => state.user);
  return { user };
}
