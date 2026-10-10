import { useEffect, useRef } from 'react';
import { useHaptics } from '@/features/feedback/haptics';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Group } from '@/components/grouped-list';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import { ActionButton, AppText, Page, Panel, StepList } from '@/components/ui';
import { AlertRow, EmptyContent, LevelChip, SectionTitle } from '@/components/content';
import { compareAlerts, formatAlertTime, levelLabels, mapAlert } from '@/features/alerts/alerts';
import { findAlert, useAlerts } from '@/features/alerts/use-alerts';
import { AlertLocationButton } from '@/features/alerts/location-button';
import { ListenButton } from '@/components/listen-button';
import { useAccess } from '@/features/access/use-access';
import { colors } from '@/theme';

export function AlertsScreen({ sheet = false }: { sheet?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const alerts = useAlerts();
  const items = [...alerts.items].sort(compareAlerts).map(item => mapAlert(item, t));
  return <Page><View style={{ gap: 12 }}>
    {alerts.status === 'no-location' && <><AppText>{t('alertNoLocationTitle')}</AppText><AppText>{t('alertNoLocationBody')}</AppText><AlertLocationButton reload={alerts.reload} /></>}
    {alerts.status === 'error' && <><AppText>{t('alertUnavailable')}</AppText><ActionButton variant="secondary" label={t('tryAgain')} onPress={() => void alerts.reload()} /></>}
    {alerts.stale && <AppText variant="small">{t('alertStale', { time: formatAlertTime(new Date(alerts.updatedAt!).toISOString()) })}</AppText>}
    {items.length ? <Group>{items.map(alert => <AlertRow key={alert.id} alert={alert} onPress={() => router.push({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } })} />)}</Group> : alerts.status === 'ready' ? <EmptyContent message="alertsEmpty" /> : null}
  </View></Page>;
}

export function AlertScreen({ sheet = false }: { sheet?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  useAlerts();
  const item = findAlert(id);
  const { t } = useTranslation();
  const alert = item ? mapAlert(item, t) : undefined;
  const router = useRouter();
  const access = useAccess();
  const haptics = useHaptics();
  const alerted = useRef(false);
  useEffect(() => {
    if (!alert || alerted.current) return;
    alerted.current = true;
    haptics.alert(alert.level);
  }, [alert, haptics.alert]);
  if (!alert) return <Page><EmptyContent /></Page>;
  const go = (pathname: '/buddy' | '/discover' | '/evacuate', params?: Record<string, string>) => sheet ? router.dismissTo({ pathname, params }) : router.navigate({ pathname, params });
  const findRoute = () => {
    if (access.voiceHome) { go('/evacuate', { alertId: id }); return; }
    go('/discover', { route: String(Date.now()) });
  };
  return <Page>
    <View style={{ gap: 10 }}>
      <View style={styles.chips}><LevelChip level={alert.level} /></View>
      <AppText variant="title" accessibilityRole="header">{t(alert.title)}</AppText>
      <AppText>{alert.area}</AppText>
      {(alert.issued || alert.window) && <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{[alert.issued, alert.window].filter(Boolean).join('\n')}</AppText>}
    </View>
    {access.listen && <ListenButton text={[t(levelLabels[alert.level]), t(alert.title), alert.area, alert.body, ...alert.steps.map((step, index) => `${index + 1}. ${t(step)}`)].join('. ')} auto={access.autoRead} />}
    <Panel><SectionTitle>{t('warningContent')}</SectionTitle><AppText selectable>{alert.body}</AppText></Panel>
    <View style={{ gap: 14 }}>
      <SectionTitle>{t('nextSteps')}</SectionTitle>
      {alert.steps.length ? <StepList steps={alert.steps.map(step => t(step))} /> : <AppText style={{ color: colors.muted }}>{t('nextStepsBody')}</AppText>}
    </View>
    <View style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('findRouteToShelter')} icon={<IconNavigation size={20} color={colors.surface} />} onPress={findRoute} />
      <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => go('/buddy')} />
    </View>
    <AppText variant="small" style={{ color: colors.muted }}>{t('alertLimit')}</AppText>
  </Page>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
