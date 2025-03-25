export function getLocalStorageSession() {
  const sessionJson = localStorage.getItem('modelence.session');
  try {
    return sessionJson ? JSON.parse(sessionJson) : null;
  } catch (e) {
    console.error('Error parsing session from localStorage', e);
    return null;
  }
}

export function setLocalStorageSession(session: object) {
  localStorage.setItem('modelence.session', JSON.stringify(session));
}
