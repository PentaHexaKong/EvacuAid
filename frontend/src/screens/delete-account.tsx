import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Field, Page } from '@/components/ui';
import { stopAlertArea } from '@/features/location/alert-area';
import { useGuestSession } from '@/features/profile/session';
import type { ApiError } from '@/features/profile/api';
import { colors } from '@/theme';

export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const session = useGuestSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current || !password) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await session.deleteAccount(password);
      await stopAlertArea().catch(() => {});
    } catch (cause) {
      const status = (cause as ApiError).status;
      setError(t(status === 403 ? 'deleteAccountWrongPassword' : status === 409 ? 'deleteAccountBlocked' : 'deleteAccountError'));
    } finally { pending.current = false; setBusy(false); }
  };
  return <Page keyboard>
    <AppText variant="title" accessibilityRole="header">{t('deleteAccountTitle')}</AppText>
    <AppText>{t('deleteAccountBody')}</AppText>
    <Field accessibilityLabel={t('authPassword')} placeholder={t('authPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password" maxLength={128} editable={!busy} invalid={!!error} returnKeyType="go" onSubmitEditing={() => void submit()} />
    <AppText variant="small" style={{ color: colors.muted }}>{t('deleteAccountPassword')}</AppText>
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{error}</AppText>}
    <ActionButton variant="destructive" label={t('deleteAccount')} loading={busy} disabled={!password} onPress={() => void submit()} />
  </Page>;
}
