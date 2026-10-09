import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetScrollView, useBottomSheetSpringConfigs, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import { ActionButton, AppText } from '@/components/ui';
import { Group, Row } from '@/components/grouped-list';
import { DiscoverMap, type DiscoverMarker, type MapMode } from '@/components/discover-map';
import { MAP_CONTROLS_BOX } from '@/components/map-framing';
import { levelLabels, mapAlert, topAlert } from '@/features/alerts/alerts';
import { useAlerts } from '@/features/alerts/use-alerts';
import { useRecentHazards } from '@/features/hazards/use-recent-hazards';
import { hazardZones, zoneRadii, type ZoneSource } from '@/features/hazards/zones';
import type { Shelter } from '@/features/navigation/api';
import { useEvacuationRoute, type EvacuationState } from '@/features/navigation/use-evacuation-route';
import { formatDistance } from '@/features/navigation/distance';
import { useProfile } from '@/features/profile/context';
import { useGuestSession } from '@/features/profile/session';
import { useAccess } from '@/features/access/use-access';
import { useHaptics } from '@/features/feedback/haptics';
import { colors, corner, hazard, radius, sky, SystemReduceMotionContext } from '@/theme';
import { spring } from '@/theme/motion';

const MIN_PEEK = 176;
// Flighty-style floating sheet: inset from the screen edges, its corners concentric with the display's (~54pt).
const SHEET_INSET = 10;
const SHEET_RADIUS = 54 - SHEET_INSET;
// Where the map is framed before there is a location: central Jakarta, matching the map's default camera.
const DEFAULT_CENTER = { latitude: -6.2675, longitude: 106.8095 };

export function DiscoverScreen() {
  const { user } = useGuestSession();
  return <Explore key={user?.id ?? 'signed-out'} />;
}

function Explore() {
  const access = useAccess();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { route: routeRequest, focus: focusRequest } = useLocalSearchParams<{ route?: string; focus?: string }>();
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
  // The map buttons sit top-right under the status bar and fade out as the sheet rises over them.
  const controlsBottom = insets.top + 8 + MAP_CONTROLS_BOX;
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetTop.get(), [controlsBottom, controlsBottom + 48], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: insets.top + 8 }],
  }));
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [mode, setMode] = useState<MapMode>(() => (reduceMotion ? '2d' : '3d'));
  const [selected, setSelected] = useState<string | null>(null);
  const [primaryHeight, setPrimaryHeight] = useState(MIN_PEEK);
  const peek = Math.max(MIN_PEEK, primaryHeight + 40);
  // Flighty-style split: the sheet rests at 55% so the map keeps the top of the screen.
  const snapPoints = useMemo(() => {
    const middle = height * 0.55;
    const first = Math.min(peek + insets.bottom, middle - 72);
    return [first, middle, Math.max(height * 0.92, middle + 48)];
  }, [peek, insets.bottom, height]);
  const [sheetIndex, setSheetIndex] = useState(1);
  const creditsInset = snapPoints[Math.min(sheetIndex, 1)];
  const hazards = useRecentHazards();
  const locale = i18n.language;

  const shelters = useMemo(() => evacuation.shelters ?? [], [evacuation.shelters]);
  const destinationId = evacuation.route?.response.destination?.shelterId ?? null;
  const focus = shelters.find(item => item.id === (destinationId ?? selected)) ?? shelters[0] ?? null;
  const otherShelters = shelters.filter(item => item.id !== focus?.id);
  if (access.stepFree) {
    const rank = (item: Shelter) => item.wheelchairAccessible === true ? 0 : item.wheelchairAccessible === null ? 1 : 2;
    otherShelters.sort((a, b) => rank(a) - rank(b));
  }
  const alerts = useAlerts();
  const items = alerts.items.map(item => mapAlert(item, t));
  const top = topAlert(alerts.items);
  const alert = top ? mapAlert(top, t) : undefined;
  const level = alert?.level ?? 'normal';
  // "Show on the map" from a disaster's detail page passes its coordinates. The param can also arrive through a deep link, so it is
  // only honoured when it names a hazard already in the feed, and it never replaces what the map says about the user's own surroundings.
  const focused = useMemo(() => {
    const [latitude, longitude] = (focusRequest ?? '').split(',').map(Number);
    if (!focusRequest || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return hazards.items.find(item => item.latitude === latitude && item.longitude === longitude) ?? null;
  }, [focusRequest, hazards.items]);
  // Wide enough to show the whole estimated impact ring, never tighter than a district.
  const mapFocus = useMemo(() => focused ? { latitude: focused.latitude!, longitude: focused.longitude!, spanKm: Math.max(15, (zoneRadii(focused).at(-1) ?? 0) * 1.6) } : null, [focused]);
  const near = evacuation.origin ?? DEFAULT_CENTER;
  const impact = useMemo(() => {
    const nearby = hazardZones(hazards.items, near);
    if (!focused || nearby.items.some(item => item.id === focused.id)) return nearby;
    const extra = hazardZones([focused], null);
    return { zones: { ...nearby.zones, features: [...nearby.zones.features, ...extra.zones.features] }, items: [...nearby.items, ...extra.items] };
  }, [hazards.items, near, focused]);
  const locate = () => { if (mapFocus) router.setParams({ focus: '' }); evacuation.locate(); };
  const markers = useMemo<DiscoverMarker[]>(() => [
    ...shelters.map(item => ({ id: item.id, kind: 'destination' as const, title: item.name, coordinate: { latitude: item.latitude, longitude: item.longitude } })),
    ...items.map(item => ({ id: item.id, kind: 'alert' as const, title: `${t(levelLabels[item.level])}: ${t(item.title)}`, coordinate: item.coordinate })),
  ], [shelters, alerts.items, t]);

  const openAlert = (id: string) => router.push({ pathname: '/alert/[id]', params: { id } });
  const selectShelter = (id: string) => {
    setSelected(id);
    if (evacuation.route) evacuation.clearRoute();
    sheet.current?.snapToIndex(0);
  };
  const onMarker = (id: string) => (items.some(item => item.id === id) ? openAlert(id) : selectShelter(id));
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
    <DiscoverMap items={markers} selected={destinationId ?? selected} onSelect={onMarker} route={evacuation.route?.coordinates} zones={impact.zones} mode={mode} onToggleMode={() => setMode(current => (current === '3d' ? '2d' : '3d'))} userLocation={evacuation.origin} focus={mapFocus} onLocate={locate} topInset={insets.top} bottomInset={snapPoints[1]} creditsInset={creditsInset} controlsStyle={controlsStyle} />
    {/* The sheet's body runs below the screen at lower snaps; this frame clips it so the bottom corners always show. */}
    <View pointerEvents="box-none" style={styles.sheetFrame}>
    <BottomSheet ref={sheet} index={access.listFirst ? 2 : 1} animatedPosition={sheetTop} animationConfigs={sheetSpring} snapPoints={snapPoints} onAnimate={(_, to) => setSheetIndex(Math.max(0, to))} enableDynamicSizing={false} topInset={insets.top} backgroundComponent={SheetBackground} handleIndicatorStyle={{ backgroundColor: sky[level].ink, opacity: 0.25, width: 40 }} accessible={false}>
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 + insets.bottom, gap: 28 }}>
        <View onLayout={event => setPrimaryHeight(Math.round(event.nativeEvent.layout.height))} style={{ gap: 16, paddingTop: 4 }}>
          {alert && <Pressable accessibilityRole="button" accessibilityLabel={`${t(alert.title)}. ${t(levelLabels[alert.level])}`} accessibilityHint={t('openAlertHint')} onPress={() => openAlert(alert.id)} style={({ pressed }) => [styles.alertChip, pressed && { opacity: 0.85 }]}>
            <IconAlertTriangle size={22} color={sky[level].ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="button" numberOfLines={2} style={{ color: sky[level].ink }}>{t(alert.title)}</AppText>
              <AppText variant="small" style={{ color: sky[level].ink }}>{t(levelLabels[alert.level])}</AppText>
            </View>
            <IconChevronRight size={20} color={sky[level].ink} />
          </Pressable>}
          <Primary state={evacuation} focus={focus} locale={locale} onRoute={route} onLocate={evacuation.locate} onRetry={retry} onChooseAnother={chooseAnother} />
        </View>
        {impact.items.length > 0 && <ImpactLegend items={impact.items} locale={locale} />}
        {evacuation.phase !== 'ready' && shelters.length > 1 && <View style={{ gap: 12 }}>
          <AppText variant="section" accessibilityRole="header">{t('otherShelters')}</AppText>
          <Group>{otherShelters.map(item => <Row key={item.id} title={item.name} detail={`${formatDistance(item.distanceM, locale)} · ${t(accessKey(item))}`} trailing={<IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />} onPress={() => selectShelter(item.id)} />)}</Group>
        </View>}
        <View style={{ gap: 12 }}>
          <AppText variant="section" accessibilityRole="header">{t('nearbyAlerts')}</AppText>
          <Group>{items.map(item => <Row key={item.id} title={t(item.title)} detail={[t(levelLabels[item.level]), item.issued].filter(Boolean).join(' · ')} trailing={<IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />} onPress={() => openAlert(item.id)} />)}</Group>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
    </View>
  </View>;
}

function SheetBackground({ style }: BottomSheetBackgroundProps) {
  const { items } = useAlerts();
  const { stops } = sky[topAlert(items)?.level ?? 'normal'];
  return <View pointerEvents="none" style={[style, styles.sheet]}>
    <LinearGradient colors={[stops[1], stops[2], colors.surface]} locations={[0, 0.5, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 168 }} />
  </View>;
}

type PrimaryProps = { state: EvacuationState; focus: Shelter | null; locale: string; onRoute: (shelterId?: string) => void; onLocate: () => void; onRetry: () => void; onChooseAnother: () => void };

function Primary({ state, focus, locale, onRoute, onLocate, onRetry, onChooseAnother }: PrimaryProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { accessibility } = useProfile();
  const askBuddy = accessibility.length > 0 && <ActionButton variant="secondary" label={t('askBuddy')} icon={<IconUsers size={20} color={colors.primary} />} onPress={() => router.navigate({ pathname: '/buddy', params: { help: String(Date.now()) } })} />;
  const { phase, route } = state;
  if (phase === 'ready' && route) {
    const { response } = route;
    const destination = response.destination;
    const evaluation = response.evaluation;
    return <>
      <View style={{ gap: 4 }} accessible accessibilityLabel={`${formatDistance(response.route!.distanceM, locale)}, ${t('minutes', { count: Math.max(1, Math.ceil(response.route!.durationSec / 60)) })}. ${t('walkTo', { name: destination?.name ?? '' })}`}>
        <AppText variant="figure">{formatDistance(response.route!.distanceM, locale)} · {t('minutes', { count: Math.max(1, Math.ceil(response.route!.durationSec / 60)) })}</AppText>
        <AppText variant="button">{t('walkTo', { name: destination?.name ?? '' })}</AppText>
      </View>
      {/* The action sits above the notes so it clears the tab bar at the sheet's resting height. */}
      <ActionButton variant="gradient" label={t('evacuateStart')} onPress={() => router.push({ pathname: '/evacuate', params: { shelterId: destination?.shelterId } })} />
      {evaluation && <View style={{ gap: 8 }}>
        <Evidence caution={evaluation.safetyStatus !== 'NO_KNOWN_HAZARD'}>{t(`hazard_${evaluation.safetyStatus}`)}</Evidence>
        <Evidence caution>{t(`routeAccess_${evaluation.accessibilityStatus}`)}</Evidence>
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
    {askBuddy}
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
      {/* One line of facts instead of cards; anything uncertain keeps the caution color next to its words. */}
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>
        {formatDistance(focus.distanceM, locale)}
        {' · '}<AppText variant="small" style={{ color: focus.wheelchairAccessible === true ? colors.muted : colors.caution }}>{t(accessKey(focus))}</AppText>
        {' · '}<AppText variant="small" style={{ color: focus.status === 'OPEN' ? colors.muted : colors.caution }}>{capacityText(focus, t)}</AppText>
      </AppText>
    </View>
    <ActionButton variant="gradient" label={busy ? busyLabel : t(isNearest ? 'routeToShelter' : 'routeHere')} loading={busy} onPress={() => onRoute(isNearest ? undefined : focus.id)} />
    {askBuddy}
  </>;
}

// The text side of the drawn zones: every color on the map is named here, with the estimate stated.
function ImpactLegend({ items, locale }: { items: ZoneSource[]; locale: string }) {
  const { t } = useTranslation();
  const magnitude = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const names = items.map(item => `${t(`hazard_${item.type}`)}${item.type === 'earthquake' && item.magnitude != null ? ` M${magnitude.format(item.magnitude)}` : ''}`);
  return <View accessible accessibilityLabel={`${t('impactEstimate')}: ${names.join(', ')}. ${t('impactEstimateNote')}`} style={styles.metaRow}>
    <AppText variant="small" style={{ color: colors.muted }}>{t('impactEstimate')}</AppText>
    {names.map((name, index) => <View key={items[index].id} style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: hazard[items[index].type] }]} />
      <AppText variant="small">{name}</AppText>
    </View>)}
  </View>;
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



const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  alertChip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, ...corner(radius.sm) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  sheet: { backgroundColor: colors.surface, ...corner(SHEET_RADIUS), overflow: 'hidden' },
  sheetFrame: { position: 'absolute', top: 0, left: SHEET_INSET, right: SHEET_INSET, bottom: SHEET_INSET, overflow: 'hidden', borderBottomLeftRadius: SHEET_RADIUS, borderBottomRightRadius: SHEET_RADIUS, borderCurve: 'continuous' },
  evidence: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, ...corner(radius.sm) },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
