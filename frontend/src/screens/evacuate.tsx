import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import IconCamera from '@tabler/icons-react-native/IconCamera';
import IconCameraOff from '@tabler/icons-react-native/IconCameraOff';
import IconX from '@tabler/icons-react-native/IconX';
import IconCircleCheck from '@tabler/icons-react-native/IconCircleCheck';
import { ActionButton, AppText, Tap } from '@/components/ui';
import { DiscoverMap } from '@/components/discover-map';
import { Group, Row } from '@/components/grouped-list';
import { useAccess } from '@/features/access/use-access';
import { respondToAlert } from '@/features/alerts/api';
import { activeAlertIds, applyResponse } from '@/features/alerts/use-alerts';
import { speak } from '@/features/feedback/speech';
import { useGuestSession } from '@/features/profile/session';
import { usePrimaryBuddy } from '@/features/buddy/use-primary-buddy';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { toCoordinates, type NavigationResponse } from '@/features/navigation/api';
import { ManeuverBanner, RecenterPill } from '@/features/buddy/ui/navigation-view';
import { useEvacuationGuidance } from '@/features/navigation/use-evacuation-guidance';
import { formatDistance } from '@/features/navigation/distance';
import { colors, corner, radius } from '@/theme';

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
  const [safe, setSafe] = useState(false);
  const buddyName = usePrimaryBuddy(token, true);
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
        // A recorded answer ends on a clear confirmation; the Buddy sees it on their own Home, nothing is pushed to them.
        setSafe(true);
        if (access.listen && !access.soundFree) void speak([t('evacuateSafeTitle'), ...(buddyName ? [t('evacuateSafeBuddy', { name: buddyName })] : [])].join('. '), i18n.language).catch(() => {});
        return;
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
  // Voice-first walkers see the street ahead behind their directions. The camera only shows it; nothing is detected or recorded.
  const [permission, requestCamera] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(true);
  // Set once a camera actually runs. A simulator has none, so it keeps the plain screen.
  const [cameraWorks, setCameraWorks] = useState(false);
  const wantsCamera = ready && !denied && access.voiceHome && focused;
  useEffect(() => { if (wantsCamera && permission && !permission.granted && permission.canAskAgain) void requestCamera(); }, [wantsCamera, permission, requestCamera]);
  const showCamera = wantsCamera && Boolean(permission?.granted);
  const canToggle = showCamera && cameraWorks;
  const lens = canToggle && cameraOn;
  if (safe) return <View accessibilityViewIsModal style={[styles.safe, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 12 }]}>
    <View style={styles.safeIcon}><IconCircleCheck size={34} strokeWidth={2} color={colors.surface} /></View>
    <AppText variant="title" accessibilityRole="header">{t('evacuateSafeTitle')}</AppText>
    {buddyName && <AppText>{t('evacuateSafeBuddy', { name: buddyName })}</AppText>}
    <View style={{ flex: 1 }} />
    <ActionButton variant="gradient" label={t('evacuateSafeDone')} onPress={leave} />
  </View>;
  // Sighted walkers follow the map. The text screen below is for voice-first use and for every state without a route.
  if (ready && !denied && !access.voiceHome) {
    const destination = response!.destination;
    return <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }}>
      <DiscoverMap items={destination ? [{ id: destination.shelterId, kind: 'destination', title: destination.name, coordinate: destination }] : []} selected={destination?.shelterId ?? null} onSelect={() => {}} route={line} userLocation={guidance.position ?? evacuation.origin} onLocate={() => setPaused(false)} topInset={insets.top} bottomInset={panelHeight} creditsInset={panelHeight} controlsStyle={controlsStyle} follow={!paused} onFollowChange={following => setPaused(!following)} walked={guidance.walked} />
      <ManeuverBanner guidance={guidance} busy={evacuation.phase === 'routing' || evacuation.phase === 'locating'} name={null} top={insets.top + 8} onLayout={event => setBannerHeight(Math.round(event.nativeEvent.layout.height))} />
      {paused && <RecenterPill bottom={panelHeight + 16} onPress={() => setPaused(false)} />}
      {/* Large text or a long entrance note can outgrow the screen, so the panel scrolls instead of pushing Stop out of reach. */}
      <ScrollView onLayout={event => setPanelHeight(Math.round(event.nativeEvent.layout.height))} style={styles.panel} contentContainerStyle={{ gap: 12, paddingTop: 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="figure" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontVariant: ['tabular-nums'] }}>{t('evacuateRemaining', { distance: formatDistance(guidance.remainingM, i18n.language), minutes: guidance.minutes })}</AppText>
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
      </ScrollView>
    </View>;
  }
  const then = ready && !guidance.arrived && guidance.upcoming ? `${guidance.upcoming} · ${formatDistance(guidance.nextManeuverM, i18n.language)}` : null;
  const entrance = response?.destination?.entranceNote;
  const look = lens ? lensed : plain;
  return <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.canvas }}>
    {showCamera && cameraOn && <CameraView style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraWorks(true)} onMountError={() => setCameraWorks(false)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
    {/* Over the camera the directions start below the status bar: iOS frosts whatever a scroll view slides under it, and over the street that frost reads as a smear. */}
    <ScrollView style={lens ? { flex: 1, marginTop: insets.top } : { flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ flexGrow: 1, paddingTop: lens ? 0 : insets.top, gap: 16 }}>
      <View style={look.top}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Tap accessibilityLabel={t('evacuateStop')} onPress={stop} style={look.icon}><IconX size={24} color={colors.ink} /></Tap>
          {canToggle && <Tap accessibilityLabel={t(cameraOn ? 'evacuateCameraOff' : 'evacuateCameraOn')} onPress={() => setCameraOn(on => !on)} style={look.icon}>{cameraOn ? <IconCameraOff size={24} color={colors.ink} /> : <IconCamera size={24} color={colors.ink} />}</Tap>}
        </View>
        <View style={look.card}>
          {response?.destination && <AppText variant="small" style={{ color: colors.muted }}>{t('evacuateTo', { name: response.destination.name })}</AppText>}
          <AppText variant="title" accessibilityRole="header">{denied ? t('evacuateNeedsLocation') : unavailable ? t('evacuateNoRoute') : !ready ? t('evacuateStarting') : guidance.arrived ? t('arriveHere') : guidance.instruction ?? t('evacuateLocating')}</AppText>
          {!ready && !denied && !unavailable && <ActivityIndicator color={colors.primary} />}
          {ready && <AppText style={{ fontVariant: ['tabular-nums'] }}>{t('evacuateRemaining', { distance: formatDistance(guidance.remainingM, i18n.language), minutes: guidance.minutes })}</AppText>}
          {/* Over the camera the steps shrink to lines, so most of the screen shows the street. */}
          {then && (lens ? <AppText>{t('evacuateThen')}: {then}</AppText> : <Group><Row title={t('evacuateThen')} detail={then} /></Group>)}
          {entrance && (lens ? <AppText variant="small">{t('evacuateEntrance')}: {entrance}</AppText> : <Group><Row title={t('evacuateEntrance')} detail={entrance} /></Group>)}
          {guidance.caption && <AppText accessibilityLiveRegion="polite">{guidance.caption}</AppText>}
          {denied && <ActionButton variant="secondary" label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} />}
          {outdated && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('evacuateRouteOutdated')}</AppText>}
          {(denied || unavailable || outdated) && <ActionButton variant="secondary" label={t('tryAgain')} onPress={() => { void evacuation.findRoute(shelterId ?? response?.destination?.shelterId); }} />}
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={[look.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {failed && <AppText accessibilityRole="alert">{t('alertUnavailable')}</AppText>}
        {ready && <ActionButton variant="gradient" label={t('evacuateArrived')} loading={saving} onPress={() => { void arrived(); }} />}
        <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => router.replace({ pathname: '/buddy', params: { help: String(Date.now()) } })} />
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 24, gap: 12 },
  safeIcon: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%', flexGrow: 0, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, boxShadow: `0 -2px 12px ${colors.ink}1F` },
  stop: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.canvas },
});
const plain = StyleSheet.create({
  top: { paddingHorizontal: 24, gap: 16 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { gap: 16 },
  bottom: { paddingHorizontal: 24, gap: 12 },
});
// Over the camera every word sits on a solid surface, so it reads against any street, day or night.
const lensed = StyleSheet.create({
  top: { paddingHorizontal: 12, gap: 12 },
  icon: { ...plain.icon, borderRadius: 22, backgroundColor: colors.surface },
  card: { gap: 8, paddingVertical: 16, paddingHorizontal: 20, ...corner(radius.lg), backgroundColor: colors.surface },
  bottom: { paddingHorizontal: 20, paddingTop: 16, gap: 12, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface },
});
