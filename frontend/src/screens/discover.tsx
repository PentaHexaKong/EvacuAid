import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetScrollView, useBottomSheetSpringConfigs } from '@gorhom/bottom-sheet';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import { ActionButton, AppText } from '@/components/ui';
import { ContentRow, ExampleChip } from '@/components/content';
import { DiscoverMap, type DiscoverMarker } from '@/components/discover-map';
import { sampleAlerts } from '@/features/content/samples';
import { DEMO_SOURCE, type Shelter } from '@/features/navigation/api';
import { useEvacuationRoute, type EvacuationState } from '@/features/navigation/use-evacuation-route';
import { useGuestSession } from '@/features/profile/session';
import { useHaptics } from '@/features/feedback/haptics';
import { colors, corner, radius } from '@/theme';
import { spring } from '@/theme/motion';

const MIN_PEEK = 176;

export function DiscoverScreen() {
  const { user } = useGuestSession();
  return <Explore key={user?.id ?? 'signed-out'} />;
}

function Explore() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { route: routeRequest } = useLocalSearchParams<{ route?: string }>();
  const evacuation = useEvacuationRoute(routeRequest);
  const { ensureGuest } = useGuestSession();
  const sheet = useRef<BottomSheet>(null);
  const sheetTop = useSharedValue(Number.MAX_SAFE_INTEGER);
  const { height } = useWindowDimensions();
  const haptics = useHaptics();
  const hapticsRef = useRef(haptics);
  useEffect(() => { hapticsRef.current = haptics; });
  const phase = evacuation.phase;
  useEffect(() => {
    if (phase === 'ready') hapticsRef.current.success();
    if (phase === 'unavailable') hapticsRef.current.warning();
  }, [phase]);
  const sheetSpring = useBottomSheetSpringConfigs(spring.sheet);
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetTop.get(), [insets.top + 72, insets.top + 160], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(sheetTop.get(), [insets.top + 72, insets.top + 160], [-8, 0], Extrapolation.CLAMP) }],
  }));
  const [selected, setSelected] = useState<string | null>(null);
  const [primaryHeight, setPrimaryHeight] = useState(MIN_PEEK);
  const peek = Math.max(MIN_PEEK, primaryHeight + 40);
  const snapPoints = useMemo(() => {
    const first = peek + insets.bottom;
    const middle = Math.max(height * 0.55, first + 72);
    return [first, middle, Math.max(height * 0.92, middle + 48)];
  }, [peek, insets.bottom, height]);
  const locale = i18n.language;

  const shelters = useMemo(() => evacuation.shelters ?? [], [evacuation.shelters]);
  const destinationId = evacuation.route?.response.destination?.shelterId ?? null;
  const focus = shelters.find(item => item.id === (destinationId ?? selected)) ?? shelters[0] ?? null;
  const alert = sampleAlerts[0];
  const markers = useMemo<DiscoverMarker[]>(() => [
    ...shelters.map(item => ({ id: item.id, kind: 'destination' as const, title: item.name, coordinate: { latitude: item.latitude, longitude: item.longitude } })),
    ...sampleAlerts.map(item => ({ id: item.id, kind: 'alert' as const, title: `${t(item.severity)}: ${t(item.title)}`, coordinate: item.coordinate })),
  ], [shelters, t]);

  const openAlert = (id: string) => router.push({ pathname: '/alert/[id]', params: { id } });
  const selectShelter = (id: string) => {
    setSelected(id);
    if (evacuation.route) evacuation.clearRoute();
    sheet.current?.snapToIndex(0);
  };
  const onMarker = (id: string) => (sampleAlerts.some(item => item.id === id) ? openAlert(id) : selectShelter(id));
  const route = (shelterId?: string) => {
    sheet.current?.snapToIndex(0);
    void evacuation.findRoute(shelterId);
  };
  const retry = () => {
    if (evacuation.errorKind === 'session') { ensureGuest().catch(() => {}); return; }
    route(selected ?? undefined);
  };
  const chooseAnother = () => {
    evacuation.clearRoute();
    setSelected(null);
    sheet.current?.snapToIndex(1);
  };

  return <View style={styles.screen}>
    <DiscoverMap items={markers} selected={destinationId ?? selected} onSelect={onMarker} route={evacuation.route?.coordinates} userLocation={evacuation.origin} onLocate={evacuation.locate} topInset={insets.top} bottomInset={peek + insets.bottom} controlsStyle={controlsStyle} />
    <Animated.View style={[styles.statusWrap, { top: insets.top + 8 }, controlsStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(alert.severity)}. ${t(alert.title)}`} accessibilityHint={t('openAlertHint')} onPress={() => openAlert(alert.id)} style={({ pressed }) => [styles.status, { backgroundColor: pressed ? colors.canvas : colors.surface }]}>
        <View style={[styles.dot, { backgroundColor: colors.caution }]} />
        <AppText variant="button" numberOfLines={1} style={{ flexShrink: 1 }}>{t(alert.severity)}</AppText>
      </Pressable>
    </Animated.View>
    <BottomSheet ref={sheet} index={0} animatedPosition={sheetTop} animationConfigs={sheetSpring} snapPoints={snapPoints} enableDynamicSizing={false} topInset={insets.top} backgroundStyle={styles.sheet} handleIndicatorStyle={{ backgroundColor: colors.border, width: 40 }} accessible={false}>
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 + insets.bottom, gap: 28 }}>
        <View onLayout={event => setPrimaryHeight(Math.round(event.nativeEvent.layout.height))} style={{ gap: 16, paddingTop: 4 }}>
          <Primary state={evacuation} focus={focus} locale={locale} onRoute={route} onLocate={evacuation.locate} onRetry={retry} onChooseAnother={chooseAnother} />
        </View>
        {evacuation.phase !== 'ready' && shelters.length > 1 && <View style={{ gap: 12 }}>
          <AppText variant="section" accessibilityRole="header">{t('otherShelters')}</AppText>
          {shelters.filter(item => item.id !== focus?.id).map(item => <ContentRow key={item.id} title={item.name} detail={`${formatDistance(item.distanceM, locale)} · ${t(accessKey(item))}${item.source === DEMO_SOURCE ? ` · ${t('exampleTag')}` : ''}`} onPress={() => selectShelter(item.id)} />)}
        </View>}
        <View style={{ gap: 12 }}>
          <AppText variant="section" accessibilityRole="header">{t('nearbyAlerts')}</AppText>
          {sampleAlerts.map(item => <ContentRow key={item.id} title={t(item.title)} detail={`${t(item.severity)} · ${item.issued}`} onPress={() => openAlert(item.id)} />)}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  </View>;
}

type PrimaryProps = { state: EvacuationState; focus: Shelter | null; locale: string; onRoute: (shelterId?: string) => void; onLocate: () => void; onRetry: () => void; onChooseAnother: () => void };

function Primary({ state, focus, locale, onRoute, onLocate, onRetry, onChooseAnother }: PrimaryProps) {
  const { t } = useTranslation();
  const { phase, route } = state;
  if (phase === 'ready' && route) {
    const { response } = route;
    const destination = response.destination;
    const evaluation = response.evaluation;
    const demo = destination?.source === DEMO_SOURCE;
    const handoff = destination && (Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${destination.latitude},${destination.longitude}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=walking`);
    return <>
      <View style={{ gap: 4 }} accessible accessibilityLabel={`${formatDistance(response.route!.distanceM, locale)}, ${t('minutes', { count: Math.max(1, Math.ceil(response.route!.durationSec / 60)) })}. ${t('walkTo', { name: destination?.name ?? '' })}`}>
        <AppText variant="figure">{formatDistance(response.route!.distanceM, locale)} · {t('minutes', { count: Math.max(1, Math.ceil(response.route!.durationSec / 60)) })}</AppText>
        <AppText variant="button">{t('walkTo', { name: destination?.name ?? '' })}</AppText>
        <View style={styles.metaRow}>{demo && <ExampleChip />}<AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{t('computedAt', { time: formatTime(route.computedAt, locale) })}</AppText></View>
      </View>
      {evaluation && <View style={{ gap: 8 }}>
        <Evidence caution={evaluation.safetyStatus !== 'NO_KNOWN_HAZARD'}>{t(`hazard_${evaluation.safetyStatus}`)}</Evidence>
        <Evidence caution>{t(`routeAccess_${evaluation.accessibilityStatus}`)}</Evidence>
      </View>}
      {handoff && <View style={{ gap: 6 }}>
        <ActionButton variant="gradient" label={t(Platform.OS === 'ios' ? 'openAppleMaps' : 'openGoogleMaps')} onPress={() => { void Linking.openURL(handoff); }} />
        <AppText variant="small" style={{ color: colors.muted, textAlign: 'center' }}>{t('externalNavigation')}</AppText>
      </View>}
      <ActionButton variant="secondary" label={t('chooseAnotherShelter')} onPress={onChooseAnother} />
    </>;
  }
  if (phase === 'denied') return <>
    <Heading title={t('locationDeniedTitle')} body={t('locationDeniedBody')} />
    <ActionButton variant="secondary" label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} />
  </>;
  if (phase === 'unavailable') return <>
    <Heading title={t('routeUnavailableTitle')} body={t(`routeReason_${state.reason ?? 'default'}`, { defaultValue: t('routeReason_default') })} />
    <ActionButton variant="secondary" label={t('tryAgain')} onPress={onRetry} />
  </>;
  if (phase === 'error') return <>
    <Heading title={t('routeErrorTitle')} body={t(state.errorKind === 'network' || state.errorKind === 'config' || state.errorKind === 'session' ? 'routeErrorConnection' : state.errorKind === 'http' ? 'routeReason_default' : 'routeErrorUnknown')} />
    <ActionButton variant="secondary" label={t('tryAgain')} onPress={onRetry} />
  </>;
  const busy = phase === 'locating' || phase === 'routing';
  const busyLabel = phase === 'locating' ? t('locating') : t('calculatingRoute');
  if (!state.origin) return <>
    <Heading title={t('findShelterTitle')} body={t('findShelterBody')} />
    <ActionButton variant="gradient" label={busy ? busyLabel : t('findRouteToShelter')} loading={busy} onPress={() => onRoute()} />
  </>;
  if (state.shelters && !state.shelters.length) return <>
    <Heading title={t('noSheltersTitle')} body={t('noSheltersBody')} />
    <ActionButton variant="secondary" label={t('tryAgain')} onPress={onLocate} />
  </>;
  if (!focus) return <Heading title={t('nearestShelter')} body={t('loadingShelters')} />;
  const isNearest = state.shelters?.[0]?.id === focus.id;
  return <>
    <View style={{ gap: 4 }}>
      <AppText variant="small" style={{ color: colors.muted }}>{t(isNearest ? 'nearestShelter' : 'selectedShelter')}</AppText>
      <AppText variant="section" accessibilityRole="header">{focus.name}</AppText>
      <View style={styles.metaRow}><AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{formatDistance(focus.distanceM, locale)} {t('fromYou')}</AppText>{focus.source === DEMO_SOURCE && <ExampleChip />}</View>
    </View>
    <View style={{ gap: 8 }}>
      <Evidence caution={focus.wheelchairAccessible !== true}>{t(accessKey(focus))}</Evidence>
      <Evidence caution={focus.status !== 'OPEN'}>{capacityText(focus, t)}</Evidence>
    </View>
    <ActionButton variant="gradient" label={busy ? busyLabel : t(isNearest ? 'routeToShelter' : 'routeHere')} loading={busy} onPress={() => onRoute(isNearest ? undefined : focus.id)} />
  </>;
}

function Heading({ title, body }: { title: string; body: string }) {
  return <View style={{ gap: 6 }}>
    <AppText variant="section" accessibilityRole="header">{title}</AppText>
    <AppText style={{ color: colors.muted }}>{body}</AppText>
  </View>;
}

function Evidence({ caution, children }: { caution: boolean; children: ReactNode }) {
  const Icon = caution ? IconAlertTriangle : IconInfoCircle;
  return <View style={[styles.evidence, { backgroundColor: caution ? colors.cautionSoft : colors.canvas }]}>
    <Icon size={20} color={caution ? colors.caution : colors.primary} style={{ marginTop: 2 }} />
    <AppText style={{ flex: 1, color: caution ? colors.caution : colors.ink }}>{children}</AppText>
  </View>;
}

function accessKey(shelter: Shelter) {
  return shelter.wheelchairAccessible === true ? 'wheelchairRecorded' : shelter.wheelchairAccessible === false ? 'wheelchairNotRecorded' : 'wheelchairUnknown';
}

function capacityText(shelter: Shelter, t: (key: string, options?: Record<string, unknown>) => string) {
  if (shelter.status === 'FULL') return t('shelterFull');
  if (shelter.status !== 'OPEN') return t('shelterStatusUnknown');
  if (shelter.capacity == null || shelter.currentOccupancy == null) return t('capacityUnknown');
  return t('capacityFilled', { used: shelter.currentOccupancy, total: shelter.capacity });
}

const kilometerFormats = new Map<string, Intl.NumberFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function formatDistance(meters: number, locale: string) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const format = kilometerFormats.get(locale) ?? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  kilometerFormats.set(locale, format);
  return `${format.format(meters / 1000)} km`;
}

function formatTime(date: Date, locale: string) {
  const format = timeFormats.get(locale) ?? new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  timeFormats.set(locale, format);
  return format.format(date);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, boxShadow: '0 2px 10px rgba(18, 40, 75, 0.14), 0 0 0 1px rgba(18, 40, 75, 0.05)' },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderCurve: 'continuous', boxShadow: '0 -2px 16px rgba(18, 40, 75, 0.10)' },
  evidence: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, ...corner(radius.sm) },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusWrap: { position: 'absolute', left: 16, maxWidth: '72%' },
});
