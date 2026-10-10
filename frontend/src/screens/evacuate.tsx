import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import IconX from '@tabler/icons-react-native/IconX';
import { ActionButton, AppText, Tap } from '@/components/ui';
import { DiscoverMap } from '@/components/discover-map';
import { Group, Row } from '@/components/grouped-list';
import { useAccess } from '@/features/access/use-access';
import { respondToAlert } from '@/features/alerts/api';
import { activeAlertIds, applyResponse } from '@/features/alerts/use-alerts';
import { speak } from '@/features/feedback/speech';
import { useGuestSession } from '@/features/profile/session';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { toCoordinates, type NavigationResponse } from '@/features/navigation/api';
import { ManeuverBanner, RecenterPill } from '@/features/buddy/ui/navigation-view';
import { useEvacuationGuidance } from '@/features/navigation/use-evacuation-guidance';
import { formatDistance } from '@/features/navigation/distance';
import { colors, radius } from '@/theme';

export function EvacuateScreen() {
  const { shelterId, alertId } = useLocalSearchParams<{ shelterId?: string; alertId?: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const access = useAccess();
  const { token } = useGuestSession();
  const evacuation = useEvacuationRoute();
  const fresh = evacuation.phase === 'ready' ? evacuation.route?.response ?? null : null;
  // A reroute clears the route while it loads and can fail close to the door. Keep guiding on the last good one meanwhile.
  const [last, setLast] = useState<NavigationResponse | null>(null);
  if (fresh && fresh !== last) setLast(fresh);
  const response = fresh ?? last;
  const guidance = useEvacuationGuidance(response, position => { void evacuation.findRoute(shelterId ?? response?.destination?.shelterId, { ...position, accuracyM: Number.isFinite(position.accuracyM) ? position.accuracyM : null }); }, focused && evacuation.phase !== 'denied');
  const findRoute = useRef(evacuation.findRoute);
  const started = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { findRoute.current = evacuation.findRoute; });
  useEffect(() => { void findRoute.current(shelterId); }, [shelterId]);
  useEffect(() => {
    if (evacuation.phase !== 'denied' || !focused) return;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void findRoute.current(shelterId ?? response?.destination?.shelterId); });
    return () => subscription.remove();
  }, [evacuation.phase, focused, shelterId, response?.destination?.shelterId]);
  useEffect(() => {
    if (!focused || evacuation.phase === 'denied' || !response?.route || started.current) return;
    started.current = true;
    if (access.listen && !access.soundFree) void speak(t('evacuateSpokenStart', { name: response.destination?.name ?? '', distance: formatDistance(response.route.distanceM, i18n.language) }), i18n.language).catch(() => {});
  }, [focused, evacuation.phase, response, access.listen, access.soundFree, t, i18n.language]);
  const leave = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const stop = () => Alert.alert(t('evacuateStopTitle'), t('evacuateStopBody'), [{ text: t('evacuateKeepGoing'), style: 'cancel' }, { text: t('evacuateStopConfirm'), style: 'destructive', onPress: leave }]);
  const arrived = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      // Arriving safe answers the warning that started this walk and any other the person said they were acting on.
      const ids = [...new Set([...(alertId ? [alertId] : []), ...activeAlertIds()])];
      if (ids.length) {
        if (!token) throw new Error('Missing guest session');
        for (const id of ids) applyResponse(id, (await respondToAlert(token, id, 'SAFE')).myResponse);
      }
      // This screen is a modal: leaving must dismiss it, not put Home on top of it.
      leave();
    } catch { setFailed(true); }
    finally { setSaving(false); }
  };
  const failedRoute = evacuation.phase === 'unavailable' || evacuation.phase === 'error';
  const unavailable = !response && failedRoute;
  // Without location there is no guidance to trust, old route or not.
  const denied = evacuation.phase === 'denied';
  // Following the last route after a failed update is said out loud on screen, never silent.
  const outdated = Boolean(response) && !fresh && failedRoute;
  const ready = Boolean(response?.route);
  const [paused, setPaused] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const line = useMemo(() => (response?.route ? toCoordinates(response.route.geometry) : undefined), [response]);
  const controlsTop = insets.top + bannerHeight + 16;
  const controlsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: controlsTop }] }), [controlsTop]);
  // A phone that locks mid-walk stops guiding, so the screen stays on for as long as guidance does.
  useEffect(() => {
    if (!ready || !focused) return;
    void activateKeepAwakeAsync('evacuate').catch(() => {});
    return () => { void deactivateKeepAwake('evacuate').catch(() => {}); };
  }, [ready, focused]);
  // Sighted walkers follow the map. The text screen below is for voice-first use and for every state without a route.
  if (ready && !denied && !access.voiceHome) {
    const destination = response!.destination;
    return <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }}>
      <DiscoverMap items={destination ? [{ id: destination.shelterId, kind: 'destination', title: destination.name, coordinate: destination }] : []} selected={destination?.shelterId ?? null} onSelect={() => {}} route={line} userLocation={guidance.position ?? evacuation.origin} onLocate={() => setPaused(false)} topInset={insets.top} bottomInset={panelHeight} creditsInset={panelHeight} controlsStyle={controlsStyle} follow={!paused} onFollowChange={following => setPaused(!following)} walked={guidance.walked} />
      <ManeuverBanner guidance={guidance} busy={evacuation.phase === 'routing' || evacuation.phase === 'locating'} name={null} top={insets.top + 8} onLayout={event => setBannerHeight(Math.round(event.nativeEvent.layout.height))} />
      {paused && <RecenterPill bottom={panelHeight + 16} onPress={() => setPaused(false)} />}
      <View onLayout={event => setPanelHeight(Math.round(event.nativeEvent.layout.height))} style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="figure" style={{ fontVariant: ['tabular-nums'] }}>{t('evacuateRemaining', { distance: formatDistance(guidance.remainingM, i18n.language), minutes: guidance.minutes })}</AppText>
            {destination && <AppText variant="small" numberOfLines={1} style={{ color: colors.muted }}>{t('evacuateTo', { name: destination.name })}</AppText>}
          </View>
          <Tap accessibilityLabel={t('evacuateStop')} onPress={stop} style={styles.stop}><IconX size={22} color={colors.ink} /></Tap>
        </View>
        {destination?.entranceNote && <AppText variant="small">{t('evacuateEntrance')}: {destination.entranceNote}</AppText>}
        {outdated && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('evacuateRouteOutdated')}</AppText>}
        {outdated && <ActionButton variant="secondary" label={t('tryAgain')} onPress={() => { void evacuation.findRoute(shelterId ?? destination?.shelterId); }} />}
        {failed && <AppText accessibilityRole="alert">{t('alertUnavailable')}</AppText>}
        <ActionButton variant="gradient" label={t('evacuateArrived')} loading={saving} onPress={() => { void arrived(); }} />
        <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => router.replace({ pathname: '/buddy', params: { help: String(Date.now()) } })} />
      </View>
    </View>;
  }
  return <ScrollView accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top, paddingBottom: insets.bottom + 12, gap: 16 }}>
    <View style={{ minHeight: 44 }}><Tap accessibilityLabel={t('evacuateStop')} onPress={stop} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><IconX size={24} color={colors.ink} /></Tap></View>
    {response?.destination && <AppText variant="small" style={{ color: colors.muted }}>{t('evacuateTo', { name: response.destination.name })}</AppText>}
    <AppText variant="title" accessibilityRole="header">{denied ? t('evacuateNeedsLocation') : unavailable ? t('evacuateNoRoute') : !ready ? t('evacuateStarting') : guidance.arrived ? t('arriveHere') : guidance.instruction ?? t('evacuateLocating')}</AppText>
    {!ready && !denied && !unavailable && <ActivityIndicator color={colors.primary} />}
    {ready && <AppText style={{ fontVariant: ['tabular-nums'] }}>{t('evacuateRemaining', { distance: formatDistance(guidance.remainingM, i18n.language), minutes: guidance.minutes })}</AppText>}
    {ready && !guidance.arrived && guidance.upcoming && <Group><Row title={t('evacuateThen')} detail={`${guidance.upcoming} · ${formatDistance(guidance.nextManeuverM, i18n.language)}`} /></Group>}
    {response?.destination?.entranceNote && <Group><Row title={t('evacuateEntrance')} detail={response.destination.entranceNote} /></Group>}
    {guidance.caption && <AppText accessibilityLiveRegion="polite">{guidance.caption}</AppText>}
    {denied && <ActionButton variant="secondary" label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} />}
    {outdated && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('evacuateRouteOutdated')}</AppText>}
    {(denied || unavailable || outdated) && <ActionButton variant="secondary" label={t('tryAgain')} onPress={() => { void evacuation.findRoute(shelterId ?? response?.destination?.shelterId); }} />}
    <View style={{ flex: 1 }} />
    <View style={{ gap: 12 }}>
      {failed && <AppText accessibilityRole="alert">{t('alertUnavailable')}</AppText>}
      {ready && <ActionButton variant="gradient" label={t('evacuateArrived')} loading={saving} onPress={() => { void arrived(); }} />}
      <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => router.replace({ pathname: '/buddy', params: { help: String(Date.now()) } })} />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 12, paddingTop: 16, paddingHorizontal: 20, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, boxShadow: `0 -2px 12px ${colors.ink}1F` },
  stop: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.canvas },
});
