import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, type ApiError } from './api';

export const AUTH_KEY = 'evacuaid.auth-session.v1';
export const GUEST_TOKEN_KEY = 'evacuaid.guest-token.v1';
export type AuthUser = { id: string; email: string; name: string | null; role: 'CITIZEN' | 'RESPONDER' | 'GOVERNMENT' | 'ADMIN' };
export type AuthTokens = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; user: AuthUser };
type Saved = { refreshToken: string; userId: string };

const signedOut = () => Object.assign(new Error('Please sign in again.'), { status: 401, kind: 'http' } satisfies Partial<ApiError>);

export function createAuthSession() {
  let tokens: AuthTokens | null = null;
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
    tokens = null; knownTokens.clear(); expiresAt = 0; notify();
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
        tokens = value; knownTokens.add(value.access_token); expiresAt = Date.now() + value.expires_in * 1000; notify();
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
      if (!raw || version !== generation) return null;
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
  const authenticate = async (mode: 'login' | 'register', email: string, password: string, name?: string, upgradeGuest = false) => {
    const version = ++generation;
    // Do not switch accounts while a rotation is writing secure storage.
    await refreshPending?.catch(() => {});
    const guest = mode === 'register' && upgradeGuest ? await SecureStore.getItemAsync(GUEST_TOKEN_KEY) : null;
    if (upgradeGuest && !guest) throw new Error('No saved guest profile is available to upgrade.');
    const value = await apiRequest<AuthTokens>('/v1/auth/'+mode, guest ?? undefined,
      { method: 'POST', body: JSON.stringify({ email: email.trim(), password, ...(mode === 'register' && name?.trim() ? { name: name.trim() } : {}) }) });
    if (!upgradeGuest) {
      try { await AsyncStorage.multiRemove(['evacuaid.profile.v1','evacuaid.onboarding-needs.v1']); }
      catch (cause) { await revoke(value.refresh_token).catch(()=>{}); throw cause; }
    }
    knownTokens.clear();
    const result = await accept(value, version);
    await SecureStore.deleteItemAsync(GUEST_TOKEN_KEY);
    return result;
  };
  const signOut = async () => {
    generation++;
    const current = tokens;
    try { await clear(); }
    finally {
      // Attempt server revocation even if the device cannot delete its saved secret.
      if (current) await revoke(current.refresh_token).catch(() => {});
    }
  };
  const current = async (requested: string) => {
    if (!tokens || !knownTokens.has(requested)) throw signedOut();
    if (expiresAt <= Date.now() + 30000) await refresh();
    if (!tokens) throw signedOut();
    return tokens.access_token;
  };
  return { restore, authenticate, signOut, refresh, current,
    get: () => tokens,
    subscribe: (listener: (value: AuthTokens | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    recover: async (rejected: string) => {
      if (!tokens || !knownTokens.has(rejected)) throw signedOut();
      if (tokens.access_token === rejected) await refresh();
      if (!tokens) throw signedOut();
      return tokens.access_token;
    },
  };
}

export const authSession = createAuthSession();
