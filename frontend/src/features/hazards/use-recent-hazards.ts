import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useGuestSession } from '@/features/profile/session';
import { fetchRecentHazards, type HazardItem } from './api';

// Home is a tab that stays mounted; refresh when the app comes back if the cards are older than this.
const STALE_MS = 5 * 60_000;

type State = { status: 'loading' | 'ready' | 'error'; items: HazardItem[] };

export function useRecentHazards() {
  const { token } = useGuestSession();
  const [state, setState] = useState<State>({ status: 'loading', items: [] });
  const mounted = useRef(true);
  const loadedAt = useRef(0);
  // Set on every mount: Fast Refresh and Strict Mode re-run effects, and a cleanup-only ref would stay false and drop every result.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!token) return;
    setState(current => ({ ...current, status: 'loading' }));
    try {
      const response = await fetchRecentHazards(token);
      loadedAt.current = Date.now();
      const available = Object.values(response.sources).some(source => source.status === 'available');
      if (mounted.current) setState({ status: available ? 'ready' : 'error', items: response.items });
    } catch {
      loadedAt.current = Date.now();
      if (mounted.current) setState({ status: 'error', items: [] });
    }
  }, [token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && Date.now() - loadedAt.current > STALE_MS) void load();
    });
    return () => subscription.remove();
  }, [load]);
  return { ...state, retry: load };
}
