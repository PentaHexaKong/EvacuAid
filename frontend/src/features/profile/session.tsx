import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, configureAuthRecovery, type ApiError, type UserProfile } from './api';
import { authSession, type AuthTokens, type AuthUser } from './auth-session';
import { clearAlertSession } from '@/features/alerts/use-alerts';
export { GUEST_TOKEN_KEY } from './auth-session';

type SessionStatus = 'idle' | 'loading' | 'ready' | 'signed-out' | 'error';
type SessionContextValue = {
  token: string | null; user: UserProfile | null; account: AuthUser | null;
  status: SessionStatus; error: string | null; errorKind: 'network' | 'http' | 'config' | null;
  ensureGuest: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, upgradeGuest?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
};
const Context = createContext<SessionContextValue>({ token:null,user:null,account:null,status:'idle',error:null,errorKind:null,
  ensureGuest:async()=>{},login:async()=>{},register:async()=>{},signOut:async()=>{} });
// Keep the existing hook name so feature callers all share the authenticated session.
export const useGuestSession = () => useContext(Context);
export const useAuthSession = useGuestSession;
export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const [value,setValue] = useState<AuthTokens | null>(authSession.get());
  const [user,setUser] = useState<UserProfile | null>(null);
  const [status,setStatus] = useState<SessionStatus>('idle');
  const [error,setError] = useState<string | null>(null);
  const [errorKind,setErrorKind] = useState<SessionContextValue['errorKind']>(null);
  useEffect(() => {
    configureAuthRecovery({ current:authSession.current,refresh:authSession.recover });
    return authSession.subscribe(next => { setValue(next); if (!next) { clearAlertSession();setUser(null);setStatus('signed-out'); } });
  },[]);
  const run = useCallback(async (operation: () => Promise<AuthTokens | null>, keepForm = false) => {
    if (keepForm) clearAlertSession();
    if (!keepForm) setStatus('loading');setError(null);setErrorKind(null);
    try {
      const next = await operation();
      if (!next) { setStatus('signed-out');return; }
      setValue(next);
      const profile = await apiRequest<UserProfile>('/v1/me',next.access_token);
      if (authSession.get()?.user.id !== next.user.id) return;
      setUser(profile);setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
      setErrorKind((cause as ApiError).kind ?? null);
      setStatus(authSession.get() ? 'error' : 'signed-out');
      throw cause;
    }
  },[]);
  const ensureGuest = useCallback(() => run(authSession.restore),[run]);
  return <Context.Provider value={{ token:value?.access_token ?? null,user,account:value?.user ?? null,status,error,errorKind,
    ensureGuest,login:(email,password)=>run(()=>authSession.authenticate('login',email,password),true),
    register:(email,password,name,upgrade)=>run(()=>authSession.authenticate('register',email,password,name,upgrade),true),
    signOut:async()=>{ await authSession.signOut();setValue(null);setUser(null);setStatus('signed-out');setError(null); }
  }}>{children}</Context.Provider>;
}
