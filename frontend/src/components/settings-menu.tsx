import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '@/features/preferences/context';

export function SettingsMenu() {
  const { t } = useTranslation();
  const { preferences, save } = usePreferences();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await save({ ...preferences, completed: false }); }
    catch { Alert.alert(t('logoutErrorTitle'), t('logoutErrorBody')); }
    finally { pending.current = false; setBusy(false); }
  };
  if (Platform.OS !== 'ios') return null;
  return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel={t('settings')} disabled={busy}>
      <Stack.Toolbar.MenuAction icon="rectangle.portrait.and.arrow.right" destructive disabled={busy} onPress={() => void logout()}>{t('logout')}</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu>
  </Stack.Toolbar>;
}
