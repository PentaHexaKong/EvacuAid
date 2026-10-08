import { useCallback, useEffect, useRef } from 'react';
import { useAccess } from '@/features/access/use-access';
import type { AlertLevel } from '@/theme';
import * as Haptics from 'expo-haptics';
import { usePreferences } from '@/features/preferences/context';

export function useHaptics() {
  const { preferences } = usePreferences();
  const enabled = preferences.vibrationEnabled;
  const { soundFree } = useAccess();
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const alert = useCallback((level: AlertLevel) => {
    if (!enabled || level === 'normal') return;
    const count = level === 'awas' ? 3 : level === 'siaga' ? 2 : 1;
    const type = level === 'awas' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning;
    const pulse = () => { void Haptics.notificationAsync(type).catch(() => {}); };
    for (let play = 0; play < (soundFree ? 2 : 1); play += 1) {
      for (let index = 0; index < count; index += 1) {
        const delay = play * ((count - 1) * 400 + 800) + index * 400;
        if (!delay) pulse();
        else {
          const timer = setTimeout(() => { timers.current.delete(timer); pulse(); }, delay);
          timers.current.add(timer);
        }
      }
    }
  }, [enabled, soundFree]);
  return {
    alert,
    tap: () => { if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
    selection: () => { if (enabled) void Haptics.selectionAsync().catch(() => {}); },
    success: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
    warning: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  };
}
