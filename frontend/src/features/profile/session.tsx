import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiRequest, type ApiError, type UserProfile } from './api';

export const GUEST_TOKEN_KEY = 'evacuaid.guest-token.v1';
type SessionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'signedOut';
type SessionContextValue = {
  token: string | null;
  user: UserProfile | null;
  status: SessionStatus;
  error: string | null;
  errorKind: 'network' | 'http' | 'config' | null;
  canStartNew: boolean;
  ensureGuest: () => Promise<void>;
  deleteGuest: () => Promise<void>;
  startNewGuest: () => Promise<void>;
};

const Context = createContext<SessionContextValue>({
  token: null, user: null, status: 'idle', error: null, errorKind: null, canStartNew: false,
  ensureGuest: async () => {}, deleteGuest: async () => {}, startNewGuest: async () => {},
});

export const useGuestSession = () => useContext(Context);

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'network' | 'http' | 'config' | null>(null);
  const [canStartNew, setCanStartNew] = useState(false);
  const pending = useRef<Promise<void> | null>(null);

  const ensureGuest = async () => {
    if (pending.current) return pending.current;
    const operation = (async () => {
      setStatus('loading');
      setError(null);
      setErrorKind(null);
      try {
        const savedToken = await SecureStore.getItemAsync(GUEST_TOKEN_KEY);
        if (savedToken) {
          try {
            const profile = await apiRequest<UserProfile>('/v1/me', savedToken);
            setToken(savedToken);
            setUser(profile);
            setCanStartNew(false);
          } catch (cause) {
            setCanStartNew((cause as ApiError)?.status === 401);
            throw cause;
          }
        } else {
          const created = await apiRequest<{ access_token: string; user: UserProfile }>('/v1/guest-sessions', undefined, { method: 'POST' });
          try { await SecureStore.setItemAsync(GUEST_TOKEN_KEY, created.access_token); }
          catch (cause) {
            await apiRequest<void>('/v1/guest-sessions/current', created.access_token, { method: 'DELETE' }).catch(() => {});
            throw cause;
          }
          setToken(created.access_token);
          setUser(created.user);
          setCanStartNew(false);
        }
        setStatus('ready');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not connect to EvacuAid.');
        setErrorKind((cause as ApiError)?.kind ?? null);
        setStatus('error');
        throw cause;
      }
    })();
    pending.current = operation;
    try { await operation; } finally { pending.current = null; }
  };

  const deleteGuest = async () => {
    if (!token) throw new Error('Guest session is not ready');
    await apiRequest<void>('/v1/guest-sessions/current', token, { method: 'DELETE' });
    await SecureStore.deleteItemAsync(GUEST_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus('signedOut');
  };

  const startNewGuest = async () => {
    if (!canStartNew) throw new Error('A new guest profile is only available after the saved session is rejected.');
    await SecureStore.deleteItemAsync(GUEST_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus('idle');
    await ensureGuest();
  };

  return <Context.Provider value={{ token, user, status, error, errorKind, canStartNew, ensureGuest, deleteGuest, startNewGuest }}>{children}</Context.Provider>;
}
