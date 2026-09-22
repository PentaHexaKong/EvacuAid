import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authApi } from './client';
import { clearSession, loadSession, saveSession } from './storage';
import type { Profile, ProfileUpdate, StoredSession } from './types';

type AuthContextValue = {
  ready: boolean;
  session: StoredSession | null;
  profile: Profile | null;
  register: (value: { name: string; email: string; password: string; rememberMe: boolean }) => Promise<void>;
  login: (value: { email: string; password: string; rememberMe: boolean }) => Promise<void>;
  loginGoogle: (idToken: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  requestReset: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  updateProfile: (value: ProfileUpdate) => Promise<void>;
};

const unavailable = async (): Promise<never> => { throw new Error('Not signed in'); };
const Context = createContext<AuthContextValue>({
  ready: true, session: null, profile: null,
  register: unavailable, login: unavailable, loginGoogle: unavailable, logout: async () => {}, requestReset: unavailable, resetPassword: unavailable, updateProfile: unavailable,
});

export function useAuth(): AuthContextValue {
  return useContext(Context);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const complete = async (response: { accessToken: string; refreshToken: string; profile: Profile }) => {
    const next = { accessToken: response.accessToken, refreshToken: response.refreshToken };
    await saveSession(next);
    setSession(next);
    setProfile(response.profile);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await loadSession();
        if (!stored) return;
        try {
          const loadedProfile = await authApi.profile(stored);
          if (active) { setSession(stored); setProfile(loadedProfile); }
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          const refreshed = await authApi.refresh(stored.refreshToken);
          if (active) await complete(refreshed);
        }
      } catch {
        await clearSession();
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    session,
    profile,
    register: async (input) => complete(await authApi.register(input)),
    login: async (input) => complete(await authApi.login(input)),
    loginGoogle: async (idToken, rememberMe) => complete(await authApi.google(idToken, rememberMe)),
    logout: async () => {
      if (session) await authApi.logout(session.refreshToken);
      await clearSession(); setSession(null); setProfile(null);
    },
    requestReset: authApi.requestReset,
    resetPassword: authApi.resetPassword,
    updateProfile: async (input) => {
      if (!session) throw new ApiError(401, 'Not signed in');
      const next = await authApi.updateProfile(session, input);
      setProfile(next);
    },
  }), [profile, ready, session]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
