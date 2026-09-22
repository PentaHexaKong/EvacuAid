import type { StoredSession } from './types';

const SESSION_KEY = 'evacuaid.auth.session.v1';

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredSession;
    return typeof value.accessToken === 'string' && typeof value.refreshToken === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  globalThis.localStorage?.removeItem(SESSION_KEY);
}
