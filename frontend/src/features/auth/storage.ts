import * as SecureStore from 'expo-secure-store';
import type { StoredSession } from './types';

const SESSION_KEY = 'evacuaid.auth.session.v1';

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredSession;
    return typeof value.accessToken === 'string' && typeof value.refreshToken === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
