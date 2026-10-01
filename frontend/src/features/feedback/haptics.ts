import * as Haptics from 'expo-haptics';
import { usePreferences } from '@/features/preferences/context';

export function useHaptics() {
  const { preferences } = usePreferences();
  const enabled = preferences.vibrationEnabled;
  return {
    selection: () => { if (enabled) void Haptics.selectionAsync().catch(() => {}); },
    success: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
    warning: () => { if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  };
}
