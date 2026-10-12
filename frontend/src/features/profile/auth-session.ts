import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, type ApiError } from './api';
import { PREFERENCES_KEY } from '@/features/preferences/storage';

export const AUTH_KEY = 'evacuaid.auth-session.v1';
export const GUEST_TOKEN_KEY = 'evacuaid.guest-token.v1';
export type AuthUser = { id: string; email: string | null; name: string | null; role: 'CITIZEN' | 'RESPONDER' | 'GOVERNMENT' | 'ADMIN' };
export type AuthTokens = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; user: AuthUser };
type Saved = { refreshToken: string; userId: string };

// A new person on this phone sees setup again; "completed" is stored per device, not per account. Other device preferences stay.
async function forgetPreviousPerson(restartSetup = true) {
  await AsyncStorage.multiRemove(['evacuaid.profile.v1','evacuaid.onboarding-needs.v1']);
  if (!restartSetup) return;
  const saved = await AsyncStorage.getItem(PREFERENCES_KEY);
  if (saved === null) return;
  let kept: Record<string, unknown> = {};
  try { kept = JSON.parse(saved) ?? {}; } catch {}
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...kept, completed: false }));
}

const signedOut = () => Object.assign(new Error('Please sign in again.'), { status: 401, kind: 'http' } satisfies Partial<ApiError>);

export function createAuthSession() {
  let tokens: AuthTokens | null = null;
  let guest = false;
  let freshGuest: string | null = null;
  let expiresAt = 0;
  let generation = 0;
  let refreshPending: Promise<AuthTokens | null> | null = null;
  let restorePending: Promise<AuthTokens | null> | null = null;
  let storageQueue: Promise<unknown> = Promise.resolve();
  const knownTokens = new Set<string>();
  const listeners = new Set<(value: AuthTokens | null) => void>();
  const notify = () => listeners.forEach(listener => listener(tokens));
  const storage = <T,>(operation: () => Promise<T>): Promise<T> => {
    const next = storageQueue.then(operation, operation);
    storageQueue = next.catch(() => {});
    return next;
  };
  const clear = async () => {
    tokens = null; guest = false; knownTokens.clear(); expiresAt = 0; notify();
    await storage(() => SecureStore.deleteItemAsync(AUTH_KEY));
  };
  const revoke = (raw: string) => apiRequest<void>('/v1/auth/logout', undefined,
    { method: 'POST', body: JSON.stringify({ refresh_token: raw }) });
  const accept = async (value: AuthTokens, version: number) => {
    try {
      await storage(async () => {
        if (generation !== version) throw signedOut();
        await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify({ refreshToken: value.refresh_token, userId: value.user.id }),
          { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
        if (generation !== version) { await SecureStore.deleteItemAsync(AUTH_KEY); throw signedOut(); }
        tokens = value; guest = false; knownTokens.add(value.access_token); expiresAt = Date.now() + value.expires_in * 1000; notify();
      });
      return value;
    } catch (cause) {
      await revoke(value.refresh_token).catch(() => {});
      throw cause;
    }
  };
  const refresh = async (saved?: Saved): Promise<AuthTokens | null> => {
    if (refreshPending) return refreshPending;
    const version = generation;
    const raw = tokens?.refresh_token ?? saved?.refreshToken;
    if (!raw) return null;
    const operation = (async () => {
      try {
        const value = await apiRequest<AuthTokens>('/v1/auth/refresh', undefined,
          { method: 'POST', body: JSON.stringify({ refresh_token: raw }) });
        if (value.user.id !== (tokens?.user.id ?? saved?.userId)) throw signedOut();
        return await accept(value, version);
      } catch (cause) {
        // A lost response may already have rotated the token. Never retry that secret.
        if (version === generation) { generation++; await clear(); }
        throw cause;
      }
    })();
    refreshPending = operation;
    try { return await operation; } finally { if (refreshPending === operation) refreshPending = null; }
  };
  const restore = async (): Promise<AuthTokens | null> => {
    if (tokens) return tokens;
    if (restorePending) return restorePending;
    const version = generation;
    const operation = (async () => {
      const raw = await SecureStore.getItemAsync(AUTH_KEY);
      if (version !== generation) return null;
      if (!raw) return resumeGuest(version);
      let saved: Saved;
      try {
        saved = JSON.parse(raw) as Saved;
        if (typeof saved.refreshToken !== 'string' || !saved.refreshToken || typeof saved.userId !== 'string') throw signedOut();
      } catch { await clear(); return null; }
      return refresh(saved);
    })();
    restorePending = operation;
    try { return await operation; } finally { if (restorePending === operation) restorePending = null; }
  };
  // A guest bearer is a plain token from development backends: no refresh, so it lasts until the server expires it.
  const adoptGuest = (token: string, user: { id: string; name: string | null }) => {
    guest = true; tokens = { access_token: token, refresh_token: '', expires_in: 0, refresh_expires_in: 0,
      user: { id: user.id, email: null, name: user.name, role: 'CITIZEN' } };
    knownTokens.clear(); knownTokens.add(token); expiresAt = Infinity; notify();
    return tokens;
  };
  const dropGuest = async () => {
    await storage(() => SecureStore.deleteItemAsync(GUEST_TOKEN_KEY));
    if (guest) { tokens = null; guest = false; knownTokens.clear(); notify(); }
  };
  const resumeGuest = async (version: number) => {
    const raw = await SecureStore.getItemAsync(GUEST_TOKEN_KEY);
    if (!raw) return null;
    try {
      // Not passed as the token argument: this bearer is not known to the session yet, so recovery would reject it.
      const user = await apiRequest<{ id: string; name: string | null }>('/v1/me', undefined, { headers: { Authorization: `Bearer ${raw}` } });
      if (version !== generation) return null;
      return adoptGuest(raw, user);
    } catch (cause) {
      // Expired or deleted on the server: forget it and offer the choice again.
      if ((cause as ApiError).status === 401) { await dropGuest(); return null; }
      throw cause;
    }
  };
  const startGuest = async () => {
    const version = ++generation;
    await refreshPending?.catch(() => {});
    const resumed = await resumeGuest(version);
    if (resumed) return resumed;
    if (version !== generation) throw signedOut();
    const created = await apiRequest<{ access_token: string; user: { id: string; name: string | null } }>('/v1/guest-sessions', undefined, { method: 'POST' });
    try {
      await forgetPreviousPerson();
      await storage(() => SecureStore.setItemAsync(GUEST_TOKEN_KEY, created.access_token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }));
    } catch (cause) {
      await apiRequest<void>('/v1/guest-sessions/current', undefined, { method: 'DELETE', headers: { Authorization: `Bearer ${created.access_token}` } }).catch(() => {});
      throw cause;
    }
    if (version !== generation) throw signedOut();
    freshGuest = created.user.id;
    return adoptGuest(created.access_token, created.user);
  };
  const authenticate = async (mode: 'login' | 'register', email: string, password: string, name?: string, upgradeGuest = false) => {
    const version = ++generation;
    // Do not switch accounts while a rotation is writing secure storage.
    await refreshPending?.catch(() => {});
    const guest = mode === 'register' && upgradeGuest ? await SecureStore.getItemAsync(GUEST_TOKEN_KEY) : null;
    if (upgradeGuest && !guest) throw new Error('No saved guest profile is available to upgrade.');
    const value = await apiRequest<AuthTokens>('/v1/auth/'+mode, guest ?? undefined,
      { method: 'POST', body: JSON.stringify({ email: email.trim(), password, ...(mode === 'register' && name?.trim() ? { name: name.trim() } : {}) }) });
    if (!upgradeGuest) {
      try { await forgetPreviousPerson(mode === 'register'); }
      catch (cause) { await revoke(value.refresh_token).catch(()=>{}); throw cause; }
    }
    knownTokens.clear();
    const result = await accept(value, version);
    await SecureStore.deleteItemAsync(GUEST_TOKEN_KEY);
    return result;
  };
  const signOut = async () => {
    generation++;
    // Leaving a guest keeps its token, so "Continue as guest" or creating an account can pick the same profile back up.
    if (guest) { tokens = null; guest = false; knownTokens.clear(); notify(); return; }
    const current = tokens;
    try { await clear(); }
    finally {
      // Attempt server revocation even if the device cannot delete its saved secret.
      if (current) await revoke(current.refresh_token).catch(() => {});
    }
  };
  const deleteAccount = async (password: string) => {
    if (!tokens || guest) throw signedOut();
    // /v1/auth/* skips the API client's token renewal, so renew here before the one request that needs a live token.
    const token = await current(tokens.access_token);
    await apiRequest<void>('/v1/auth/me', token, { method: 'DELETE', body: JSON.stringify({ password }) });
    await signOut();
    await forgetPreviousPerson();
  };
  const current = async (requested: string) => {
    if (!tokens || !knownTokens.has(requested)) throw signedOut();
    if (expiresAt <= Date.now() + 30000) await refresh();
    if (!tokens) throw signedOut();
    return tokens.access_token;
  };
  return { restore, authenticate, startGuest, signOut, deleteAccount, refresh, current,
    get: () => tokens,
    isGuest: () => guest,
    // True once for a guest this device just created, so its preferences can start from the choices made before it existed.
    takeFreshGuest: (userId: string) => { const fresh = freshGuest === userId; if (fresh) freshGuest = null; return fresh; },
    subscribe: (listener: (value: AuthTokens | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    recover: async (rejected: string) => {
      if (!tokens || !knownTokens.has(rejected)) throw signedOut();
      if (guest) { await dropGuest(); throw signedOut(); }
      if (tokens.access_token === rejected) await refresh();
      if (!tokens) throw signedOut();
      return tokens.access_token;
    },
  };
}

export const authSession = createAuthSession();
