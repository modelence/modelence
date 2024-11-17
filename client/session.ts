'use client';

import { callLoader } from './loader';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';
import { useState, useEffect } from 'react';

type Configs = Record<ConfigKey, AppConfig>;

let currentUser: object | null = null;

export async function initSession() {
  const existingSession = getLocalStorageSession();
  const { configs, session, user } = await callLoader<{ configs: Configs, session: object, user: object }>('_system.initSession', {
    authToken: existingSession?.authToken,
  });
  _setConfig(configs);
  localStorage.setItem('modelence.session', JSON.stringify(session));
  currentUser = Object.freeze(user);
}

function getLocalStorageSession() {
  const sessionJson = localStorage.getItem('modelence.session');
  try {
    return sessionJson ? JSON.parse(sessionJson) : null;
  } catch (e) {
    console.error('Error parsing session from localStorage', e);
    return null;
  }
}

export function useSession() {
  const [user, setUser] = useState(currentUser);

  // TODO: re-fetch the user on demand
  useEffect(() => {
    // Fetch and update currentUser
  }, []);

  return { user };
}
