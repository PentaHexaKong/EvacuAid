import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import IconX from '@tabler/icons-react-native/IconX';
import { ActionButton, AppText, Tap } from '@/components/ui';
import { Group, Row } from '@/components/grouped-list';
import { useAccess } from '@/features/access/use-access';
import { respondToAlert } from '@/features/alerts/api';
import { applyResponse } from '@/features/alerts/use-alerts';
import { speak } from '@/features/feedback/speech';
import { useGuestSession } from '@/features/profile/session';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { useEvacuationGuidance } from '@/features/navigation/use-evacuation-guidance';
import { formatDistance } from '@/features/navigation/distance';
import { colors } from '@/theme';

export function EvacuateScreen() {
  const { shelterId, alertId } = useLocalSearchParams<{ shelterId?: string; alertId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const access = useAccess();
  const { token } = useGuestSession();
  const evacuation = useEvacuationRoute();
  const response = evacuation.phase === 'ready' ? evacuation.route?.response ?? null : null;
  const guidance = useEvacuationGuidance(response, () => { void evacuation.findRoute(shelterId ?? response?.destination?.shelterId); });
  const findRoute = useRef(evacuation.findRoute);
  const started = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { findRoute.current = evacuation.findRoute; });
  useEffect(() => { void findRoute.current(shelterId); }, [shelterId]);
  useEffect(() => {
    if (!response?.route || started.current) return;
    started.current = true;
    if (access.listen && !access.soundFree) void speak(t('evacuateSpokenStart', { name: response.destination?.name ?? '', distance: formatDistance(response.route.distanceM, i18n.language) }), i18n.language).catch(() => {});
  }, [response, access.listen, access.soundFree, t, i18n.language]);
  const leave = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const stop = () => Alert.alert(t('evacuateStopTitle'), t('evacuateStopBody'), [{ text: t('evacuateKeepGoing'), style: 'cancel' }, { text: t('evacuateStopConfirm'), style: 'destructive', onPress: leave }]);
  const arrived = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      if (alertId) {
        if (!token) throw new Error('Missing guest session');
        const result = await respondToAlert(token, alertId, 'SAFE');
        applyResponse(alertId, result.myResponse);
      }
      router.replace('/');
    } catch { setFailed(true); }
    finally { setSaving(false); }
  };
  const unavailable = evacuation.phase === 'unavailable' || evacuation.phase === 'error';
  const denied = evacuation.phase === 'denied';
  const ready = Boolean(response?.route);
  return <ScrollView accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top, paddingBottom: insets.bottom + 12, gap: 16 }}>
    <View style={{ minHeight: 44 }}><Tap accessibilityLabel={t('evacuateStop')} onPress={stop} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><IconX size={24} color={colors.ink} /></Tap></View>
    {response?.destination && <AppText variant="small" style={{ color: colors.muted }}>{t('evacuateTo', { name: response.destination.name })}</AppText>}
    <AppText variant="title" accessibilityRole="header">{denied ? t('evacuateNeedsLocation') : unavailable ? t('evacuateNoRoute') : !ready ? t('evacuateStarting') : guidance.arrived ? t('arriveHere') : guidance.instruction ?? t('evacuateStarting')}</AppText>
    {!ready && !denied && !unavailable && <ActivityIndicator color={colors.primary} />}
    {ready && <AppText style={{ fontVariant: ['tabular-nums'] }}>{t('evacuateRemaining', { distance: formatDistance(guidance.remainingM, i18n.language), minutes: guidance.minutes })}</AppText>}
    {ready && !guidance.arrived && guidance.upcoming && <Group><Row title={t('evacuateThen')} detail={`${guidance.upcoming} · ${formatDistance(guidance.nextManeuverM, i18n.language)}`} /></Group>}
    {response?.destination?.entranceNote && <Group><Row title={t('evacuateEntrance')} detail={response.destination.entranceNote} /></Group>}
    {guidance.caption && <AppText accessibilityLiveRegion="polite">{guidance.caption}</AppText>}
    {denied && <ActionButton variant="secondary" label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} />}
    {unavailable && <ActionButton variant="secondary" label={t('tryAgain')} onPress={() => { void evacuation.findRoute(shelterId); }} />}
    <View style={{ flex: 1 }} />
    <View style={{ gap: 12 }}>
      {failed && <AppText accessibilityRole="alert">{t('alertUnavailable')}</AppText>}
      {ready && <ActionButton variant="gradient" label={t('evacuateArrived')} loading={saving} onPress={() => { void arrived(); }} />}
      <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => router.replace({ pathname: '/buddy', params: { help: String(Date.now()) } })} />
    </View>
  </ScrollView>;
}
