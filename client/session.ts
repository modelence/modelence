'use client';

import { z } from 'zod';
import { callLoader } from './loader';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';
import { useState, useEffect } from 'react';
import { setLocalStorageSession } from './localStorage';

type Configs = Record<ConfigKey, AppConfig>;

let currentUser: {
  id: string;
  handle: string;
} | null = null;

export async function initSession() {
  const { configs, session, user } = await callLoader<{ configs: Configs, session: object, user: object }>('_system.initSession');
  _setConfig(configs);
  setLocalStorageSession(session);
  currentUser = user ? Object.freeze(z.object({
    id: z.string(),
    handle: z.string(),
  }).parse(user)) : null;
}

export function useSession() {
  const [user, setUser] = useState(currentUser);

  // TODO: re-fetch the user on demand
  useEffect(() => {
    // Fetch and update currentUser
  }, []);

  return { user };
}
