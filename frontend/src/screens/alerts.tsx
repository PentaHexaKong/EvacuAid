import { useEffect, useEffectEvent, useRef } from 'react';
import { useHaptics } from '@/features/feedback/haptics';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Group } from '@/components/grouped-list';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import { ActionButton, AppText, Page, Panel, StepList } from '@/components/ui';
import { AlertRow, EmptyContent, LevelChip, SectionTitle } from '@/components/content';
import { alertsSpokenSummary, topAlert, compareAlerts, formatAlertTime, levelLabels, mapAlert } from '@/features/alerts/alerts';
import { findAlert, useAlerts } from '@/features/alerts/use-alerts';
import { AlertLocationButton } from '@/features/alerts/location-button';
import { ListenButton } from '@/components/listen-button';
import { useAccess } from '@/features/access/use-access';
import { SpeakButton } from '@/components/speak-button';
import { useBuddySpeech } from '@/features/buddy/native';
import { confirmCommand } from '@/features/voice/confirm-command';
import { useVoicePrompt } from '@/features/voice/use-voice-prompt';
import { colors } from '@/theme';

export function AlertsScreen({ sheet = false }: { sheet?: boolean }) {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const access = useAccess();
  const alerts = useAlerts();
  const items = [...alerts.items].sort(compareAlerts).map(item => mapAlert(item, t));
  const enabled = !sheet && access.voiceHome && access.listen && !access.soundFree;
  const askedAlert = useRef<string | null>(null);
  const voice = useBuddySpeech({ stopSpeechOnUnmount: false, language: i18n.language.startsWith('id') ? 'id' : 'en', onCommand: transcript => {
    if (!enabled || !prompt.focused || !askedAlert.current) return;
    const alertId = askedAlert.current;
    askedAlert.current = null;
    prompt.cancel();
    if (confirmCommand(transcript) === 'yes') router.navigate({ pathname: '/evacuate', params: { alertId } });
    else void prompt.say(t('alertsSpokenStay'));
  } });
  const prompt = useVoicePrompt(voice, enabled, i18n.language);
  const readWarnings = () => {
    askedAlert.current = null;
    if (!enabled || !prompt.focused) return;
    const unavailable = alerts.status === 'no-location' ? `${t('alertNoLocationTitle')}. ${t('alertNoLocationBody')}` : alerts.status === 'error' ? t('alertUnavailable') : alerts.stale ? t('alertStale', { time: alerts.updatedAt ? formatAlertTime(new Date(alerts.updatedAt).toISOString()) : '' }) : null;
    if (unavailable) { void prompt.say(unavailable); return; }
    if (alerts.status !== 'ready') return;
    const top = topAlert(alerts.items);
    void prompt.say(alertsSpokenSummary(alerts.items, t), () => {
      if (!top || top.level === 'waspada' || top.myResponse === 'SAFE') return;
      askedAlert.current = top.id;
      void prompt.say(t('alertsSpokenEvacuateAsk'), () => { void prompt.listen(); });
    });
  };
  const readOnFocus = useEffectEvent(readWarnings);
  const signature = JSON.stringify([...alerts.items].sort(compareAlerts).map(item => [item.id, item.level, item.hazardType, item.area, item.validUntil, item.myResponse]));
  useEffect(() => { readOnFocus(); }, [enabled, prompt.focused, signature, alerts.status, alerts.stale]);
  useEffect(() => { if (!enabled || !prompt.focused) askedAlert.current = null; }, [enabled, prompt.focused]);
  return <Page><View style={{ gap: 12 }}>
    {enabled && <>
      <SpeakButton listening={voice.listening} label={t(voice.listening ? 'voiceBuddyListening' : 'voiceBuddyMic')} detail="" hint="" onPress={() => {
        if (voice.listening) voice.stopListening();
        else {
          prompt.cancel();
          const top = topAlert(alerts.items);
          askedAlert.current = alerts.status === 'ready' && !alerts.stale && top && top.level !== 'waspada' && top.myResponse !== 'SAFE' ? top.id : null;
          void prompt.listen();
        }
      }} />
      <ActionButton variant="secondary" label={t('alertsReadAgain')} onPress={readWarnings} />
    </>}
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
