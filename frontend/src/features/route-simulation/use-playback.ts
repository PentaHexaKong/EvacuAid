import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SystemReduceMotionContext } from '@/theme';

export function usePlayback(enabled: boolean) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const elapsed = useRef(0);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const focused = useRef(false);
  const pause = useCallback(() => {
    if (started.current !== null) elapsed.current = Math.min(30000, elapsed.current + Date.now() - started.current);
    started.current = null;
    clearInterval(timer.current);
    timer.current = undefined;
    setProgress(elapsed.current / 30000);
    setPlaying(false);
  }, []);
  const reset = useCallback(() => { pause(); elapsed.current = 0; setProgress(0); }, [pause]);
  const play = () => {
    if (!enabled || !focused.current || AppState.currentState !== 'active' || started.current !== null || elapsed.current >= 30000) return;
    started.current = Date.now();
    setPlaying(true);
  };
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      if (started.current === null) return;
      const value = Math.min(1, (elapsed.current + Date.now() - started.current) / 30000);
      setProgress(value);
      if (value === 1) pause();
    }, reduceMotion ? 1000 : 50);
    return () => clearInterval(timer.current);
  }, [playing, reduceMotion, pause]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') pause(); });
    return () => { focused.current = false; subscription.remove(); pause(); };
  }, [pause]));
  return { progress, playing, play, pause, reset };
}
