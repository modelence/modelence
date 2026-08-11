const SESSION_KEY = 'modelence.session';

function hasLocalStorage(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

export function getLocalStorageSession() {
  if (!hasLocalStorage()) {
    return null;
  }

  const sessionJson = globalThis.localStorage.getItem(SESSION_KEY);
  try {
    return sessionJson ? JSON.parse(sessionJson) : null;
  } catch (e) {
    console.error('Error parsing session from localStorage', e);
    return null;
  }
}

export function setLocalStorageSession(session: object) {
  if (!hasLocalStorage()) {
    return;
  }

  globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearLocalStorageSession() {
  if (!hasLocalStorage()) {
    return;
  }

  globalThis.localStorage.removeItem(SESSION_KEY);
}
