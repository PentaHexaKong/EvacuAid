import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createSimulatedSource, type LocationSnapshot, type LocationSource } from './location-source';

export function useLocationPreview(source: LocationSource) {
  const [snapshot, setSnapshot] = useState<LocationSnapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [generation, setGeneration] = useState(0);
  useFocusEffect(useCallback(() => {
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      unsubscribe?.(); unsubscribe = undefined;
      if (timer) clearInterval(timer);
      timer = undefined;
      setSnapshot(null);
    };
    const start = () => {
      if (unsubscribe) return;
      setNow(Date.now());
      setGeneration((value) => value + 1);
      unsubscribe = source.subscribe(setSnapshot);
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start(); else stop();
    });
    return () => { subscription.remove(); stop(); };
  }, [source]));
  return { snapshot, now, generation };
}

export function useBuddyPreview() {
  const source = useMemo(() => createSimulatedSource(), []);
  return { ...useLocationPreview(source), source };
}
