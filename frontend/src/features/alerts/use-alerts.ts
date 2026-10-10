import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useGuestSession } from '@/features/profile/session';
import { fetchAlerts, type AlertItem } from './api';

type State = { status: 'loading' | 'ready' | 'no-location' | 'error'; items: AlertItem[]; updatedAt: number | null; stale: boolean };
let state: State = { status: 'loading', items: [], updatedAt: null, stale: false };
let currentToken: string | null = null;
let pending: Promise<void> | null = null;
// Bumped when the saved location changes, so a response for the old area is dropped.
let generation = 0;
const listeners = new Set<(value: State) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
const publish = (value: State) => { state = value; listeners.forEach(listener => listener(state)); };
export const applyResponse = (id: string, response: AlertItem['myResponse']) => publish({ ...state, items: state.items.map(item => item.id === id ? { ...item, myResponse: response } : item) });
export const findAlert = (id: string | undefined) => state.items.find(item => item.id === id);
async function load(token: string) {
  if (pending) return pending;
  const started = generation;
  const request = (async () => {
    try {
      const response = await fetchAlerts(token);
      if (currentToken !== token || generation !== started) return;
      if (response.status === 'no-location') publish({ status: 'no-location', items: [], updatedAt: null, stale: false });
      else publish({ status: 'ready', items: response.data.items, updatedAt: Date.now(), stale: false });
    } catch {
      if (currentToken === token && generation === started) publish({ ...state, status: state.updatedAt === null ? 'error' : 'ready', stale: state.updatedAt !== null });
    }
  })();
  pending = request;
  try { await request; } finally { if (pending === request) pending = null; }
}
export async function resetAlerts() {
  generation += 1;
  pending = null;
  publish({ status: 'loading', items: [], updatedAt: null, stale: false });
  if (currentToken) await load(currentToken);
}
const poll = () => { if (foreground && currentToken) void load(currentToken); };
function startTimer() {
  if (timer) clearInterval(timer);
  timer = foreground ? setInterval(poll, 60_000) : null;
}
export function useAlerts() {
  const { token } = useGuestSession();
  const focused = useIsFocused();
  const [value, setValue] = useState(state);
  const mounted = useRef(false);
  const reload = useCallback(async () => { if (token) await load(token); }, [token]);
  useEffect(() => {
    mounted.current = true;
    const listener = (next: State) => { if (mounted.current) setValue(next); };
    listeners.add(listener);
    if (currentToken !== token) {
      currentToken = token;
      pending = null;
      publish({ status: 'loading', items: [], updatedAt: null, stale: false });
    }
    listener(state);
    if (!subscription) {
      foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
      subscription = AppState.addEventListener('change', next => {
        const wasForeground = foreground;
        foreground = next === 'active';
        startTimer();
        if (foreground && !wasForeground) poll();
      });
      startTimer();
    }
    void Promise.resolve().then(reload);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
      if (!listeners.size) {
        if (timer) clearInterval(timer);
        timer = null;
        subscription?.remove();
        subscription = null;
      }
    };
  }, [token, reload]);
  useEffect(() => { if (focused) void Promise.resolve().then(reload); }, [focused, reload]);
  return { ...value, reload };
}
