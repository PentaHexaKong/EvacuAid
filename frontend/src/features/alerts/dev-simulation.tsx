import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { useGuestSession } from '@/features/profile/session';
import { colors, corner, radius } from '@/theme';
import { clearSimulatedAlerts, simulateAlert } from './api';

export function AlertSimulation({ reload }: { reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { token } = useGuestSession();
  const [busy, setBusy] = useState<'start' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'start' | 'clear', task: (token: string) => Promise<unknown>) => {
    if (!token || busy) return;
    setBusy(kind);
    setError(null);
    try { await task(token); await reload(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(null); }
  };
  return <View style={styles.box}>
    <AppText variant="eyebrow" style={{ color: colors.muted }}>{t('devSimulationTitle')}</AppText>
    <AppText variant="small" style={{ color: colors.muted }}>{t('devSimulationBody')}</AppText>
    <ActionButton compact variant="secondary" label={t('devSimulateEarthquake')} loading={busy === 'start'} disabled={busy === 'clear'} onPress={() => void run('start', value => simulateAlert(value, { level: 'awas', hazard: 'EARTHQUAKE' }))} />
    <ActionButton compact variant="secondary" label={t('devSimulationClear')} loading={busy === 'clear'} disabled={busy === 'start'} onPress={() => void run('clear', clearSimulatedAlerts)} />
    {error && <AppText variant="small" accessibilityRole="alert">{error}</AppText>}
  </View>;
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 16, ...corner(radius.lg), borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
});
