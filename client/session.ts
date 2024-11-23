'use client';

import { z } from 'zod';
import { callMethod } from './method';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';
import { useState, useEffect } from 'react';
import { setLocalStorageSession } from './localStorage';
import { time } from '../time';

type Configs = Record<ConfigKey, AppConfig>;

let isInitialized = false;
const SESSION_HEARTBEAT_INTERVAL = time.seconds(30);

let currentUser: {
  id: string;
  handle: string;
} | null = null;

export async function initSession() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  const { configs, session, user } = await callMethod<{ configs: Configs, session: object, user: object }>('_system.initSession');
  _setConfig(configs);
  setLocalStorageSession(session);
  currentUser = user ? Object.freeze(z.object({
    id: z.string(),
    handle: z.string(),
  }).parse(user)) : null;

  await loopSessionHeartbeat();
}

async function loopSessionHeartbeat() {
  await callMethod('_system.sessionHeartbeat');
  setTimeout(loopSessionHeartbeat, SESSION_HEARTBEAT_INTERVAL);
}

export function useSession() {
  const [user, setUser] = useState(currentUser);

  // TODO: re-fetch the user on demand
  useEffect(() => {
    // Fetch and update currentUser
  }, []);

  return { user };
}
