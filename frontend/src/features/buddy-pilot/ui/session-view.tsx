import { useAccess } from '@/features/access/use-access';
import { useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import BottomSheet, { BottomSheetScrollView, useBottomSheetSpringConfigs } from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, useAnimatedStyle } from 'react-native-reanimated';
import IconPhone from '@tabler/icons-react-native/IconPhone';
import IconRoute from '@tabler/icons-react-native/IconRoute';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, CheckOption, Field } from '@/components/ui';
import { DiscoverMap } from '@/components/discover-map.native';
import { colors, corner, gutter, radius, SystemReduceMotionContext } from '@/theme';
import { duration, spring } from '@/theme/motion';
import { relativeTime } from '@/features/hazards/time';
import { nearbyShelters } from '@/features/navigation/api';
import { buddyRequest, terminalStatuses } from '../api';
import { distanceM } from '../navigation';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, initials, StatStrip, StatusChip } from './parts';
import { RouteView } from './route-view';

const MIN_PEEK = 176;
// Same floating sheet as Discover: inset from the screen edges, corners concentric with the display's.
const SHEET_INSET = 10;
const SHEET_RADIUS = 54 - SHEET_INSET;

// An active session with a known position: the map takes the screen and the session rides in a sheet over it.
export function SessionMap({ a, token, userId, banner }: { a: BuddyActions; token: string; userId: string; banner?: ReactNode }) {
  const { state, c, requester, partner, native, route, helperRoute, requesterPoint, catchNative } = a;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { height } = useWindowDimensions();
  const sheet = useRef<BottomSheet>(null);
  const sheetSpring = useBottomSheetSpringConfigs(spring.sheet);
  const [primaryHeight, setPrimaryHeight] = useState(MIN_PEEK);
  const snapPoints = useMemo(() => {
    const peek = Math.min(Math.max(MIN_PEEK, primaryHeight + 40) + insets.bottom, height * 0.62);
    const middle = Math.max(height * 0.55, peek + 72);
    return [peek, middle, Math.max(height * 0.92, middle + 48)];
  }, [primaryHeight, insets.bottom, height]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const controlsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: headerHeight + 8 }] }));
  return <View style={styles.screen}>
    <DiscoverMap items={state.locations.filter(item => item.userId !== userId && !item.stale).map(item => ({ id: item.userId, title: partner ?? c('helper'), kind: 'person' as const, initials: initials(partner), coordinate: item }))} selected={null} onSelect={() => {}} route={requester ? helperRoute?.route?.geometry.coordinates : route?.leg === 'TO_REQUESTER' && !requesterPoint ? undefined : route?.route?.geometry.coordinates} userLocation={native.location} onLocate={() => catchNative(native.obtainLocation)} topInset={headerHeight} bottomInset={snapPoints[0]} creditsInset={snapPoints[Math.min(sheetIndex, 1)]} controlsStyle={controlsStyle} />
    {/* Keeps the bar's title readable over map labels. */}
    <LinearGradient pointerEvents="none" colors={[colors.canvas, `${colors.canvas}00`]} locations={[0.45, 1]} style={[styles.scrim, { height: headerHeight + 32 }]} />
    {/* The sheet's body runs below the screen at lower snaps; this frame clips it so the bottom corners always show. */}
    <View pointerEvents="box-none" style={styles.sheetFrame}>
      <BottomSheet ref={sheet} index={0} animationConfigs={sheetSpring} snapPoints={snapPoints} onAnimate={(_, to) => setSheetIndex(Math.max(0, to))} enableDynamicSizing={false} topInset={headerHeight} backgroundStyle={styles.sheet} handleIndicatorStyle={styles.handle} accessible={false}>
        <BottomSheetScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter - SHEET_INSET, paddingTop: 4, paddingBottom: 32 + insets.bottom, gap: 16 }}>
          <SessionView a={a} token={token} userId={userId} banner={banner} onPrimaryLayout={setPrimaryHeight} onChatFocus={() => sheet.current?.snapToIndex(2)} />
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  </View>;
}

export function SessionView({ a, token, userId, banner, onPrimaryLayout, onChatFocus }: { a: BuddyActions; token: string; userId: string; banner?: ReactNode; onPrimaryLayout?: (height: number) => void; onChatFocus?: () => void }) {
  const { soundFree } = useAccess();
  const { state, c, status, support, preferences, session, active, requester, partner, native, route, helperRoute, requesterPoint, routeBusy, wheelchair, setWheelchair, consent, setConsent, voice, statusText, confirm, catchNative, transition, startNearby, requestRoute, setCurrentInstruction } = a;
  const { t } = useTranslation();
  if (!session) return null;
  const terminal = terminalStatuses.has(session.status);
  const partnerLocation = state.locations.find(item => item.userId !== userId);
  const gps = partnerLocation ? relativeTime(partnerLocation.observedAt) : null;
  const toRequester = session.status === 'ACCEPTED' || session.status === 'EN_ROUTE';
  const eta = (requester ? helperRoute : route)?.route;
  const headline = requester && helperRoute ? c(session.status === 'EN_ROUTE' ? 'onTheWay' : 'gettingReady') : status(session.status);
  const stats = [
    { label: c('statEta'), value: eta ? `${Math.max(1, Math.ceil(eta.durationSec / 60))} ${c('minShort')}` : '—' },
    { label: c('statDistance'), value: requester && helperRoute?.route ? `${Math.round(helperRoute.route.distanceM)} m` : native.location && partnerLocation ? `${Math.round(distanceM(native.location, partnerLocation))} m` : '—' },
    { label: c('statGps'), value: gps ? (gps.key === 'timeJustNow' ? c('now') : t(gps.key, { count: gps.count })) : '—' },
  ];

  return requester ? <View style={{ gap: 16 }}>
    <View onLayout={event => onPrimaryLayout?.(Math.round(event.nativeEvent.layout.height))} style={{ gap: 16 }}>
    {banner}
    <View style={{ gap: 6 }}>
      <View style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="eyebrow" style={{ color: colors.muted }}>{session.nearby ? c('gpsAssist') : c('buddyAssist')}</AppText>
        {active && <StatusChip dot tone="info" label={c('live')} />}
      </View>
      {requester
        ? (partner ? <><AppText variant="small" style={{ color: colors.muted }}>{c('helper')}</AppText><AppText variant="title" accessibilityRole="header">{partner}</AppText></> : null)
        : <AppText variant="title" accessibilityRole="header">{c('needsHelpTitle', { name: partner ?? c('name') })}</AppText>}
    </View>

    {active && !requester && <View style={{ gap: 10 }}>
      {session.status === 'ACCEPTED' && <ActionButton label={c('depart')} loading={state.busy} onPress={() => { void transition('depart'); }} />}
      {session.status === 'EN_ROUTE' && <ActionButton label={c('arrive')} loading={state.busy} onPress={() => confirm(c('arrive'), () => { void transition('arrive'); })} />}
      {session.status === 'ARRIVED' && <AppText style={{ color: colors.muted }}>{session.meetingConfirmed ? c('meetingConfirmed') : c('waitingMeeting')}</AppText>}
      {session.status === 'ARRIVED' && <ActionButton label={c('pickup')} disabled={!session.meetingConfirmed} loading={state.busy} onPress={() => confirm(c('pickup'), () => { void transition('evacuating'); })} />}
      {['ARRIVED', 'EVACUATING'].includes(session.status) && <ActionButton variant="secondary" label={c('complete')} loading={state.busy} onPress={() => confirm(c('complete'), () => { void transition('report-complete'); })} />}
    </View>}
    {active && requester && session.status === 'ARRIVED' && !session.meetingConfirmed && <ActionButton label={c('meet')} loading={state.busy} onPress={() => confirm(c('meet'), () => { void transition('confirm-meeting'); })} />}
    {active && requester && session.status === 'COMPLETION_PENDING' && <ActionButton label={c('confirmComplete')} loading={state.busy} onPress={() => confirm(c('confirmComplete'), () => { void transition('confirm-complete'); })} />}

    </View>

    <Card tint={active ? 'info' : undefined}>
      <View style={buddyStyles.row}>
        {session.status === 'WAITING' && <ActivityIndicator color={colors.primary} />}
        <AppText variant="section" accessibilityLiveRegion="polite" style={buddyStyles.grow}>{headline}</AppText>
      </View>
      {!!session.message && <AppText selectable style={{ color: colors.muted }}>“{session.message}”</AppText>}
      {session.supportNeeds.length > 0 && <View accessible accessibilityLabel={`${c('support')}: ${session.supportNeeds.map(support).join(', ')}`} style={[buddyStyles.row, { gap: 6, flexWrap: 'wrap' }]}>{session.supportNeeds.map(need => <StatusChip key={need} label={support(need)} />)}</View>}
      {active && <StatStrip items={stats} />}
      {state.locations.some(item => item.stale) && <AppText accessibilityRole="alert" variant="small" style={{ color: colors.caution }}>{c('stale')}</AppText>}
    </Card>

    {requester && ['FALLBACK_REQUIRED', 'UNANSWERED'].includes(session.status) && <Card tint="caution">
      <AppText>{c('requestFailed')}</AppText>
      <CheckOption label={c('consent')} checked={consent} onToggle={setConsent} />
      <ActionButton label={c('nearby')} loading={state.busy} onPress={() => confirm(c('nearby'), () => { void startNearby(); }, c('nearbyExplanation'))} />
      <ActionButton variant="secondary" label={c('close')} onPress={() => { if (!terminal) void transition('interrupt'); else state.dismissSession(); }} />
    </Card>}

    {active && <View style={buddyStyles.actions}>
      <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('call')} onPress={() => catchNative(async () => { const contact = await buddyRequest<{ phone: string | null }>(token, `/requests/${session.id}/contact`); if (!contact.phone) throw new Error(c('noPhone')); await Linking.openURL(`tel:${encodeURIComponent(contact.phone)}`); })} /></View>
      {(!requester || session.meetingConfirmed) && <View style={buddyStyles.grow}><ActionButton compact label={!requester && toRequester ? c('toRequester') : c('toShelter')} loading={routeBusy} onPress={() => { void requestRoute(!requester && toRequester ? 'TO_REQUESTER' : 'TO_SHELTER'); }} /></View>}
    </View>}

    {active && session.meetingConfirmed && <ShelterCard a={a} />}
    {active && !session.meetingConfirmed && !requester && <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />}

    {active && route?.route && <RouteView key={`${session.id}:${route.route.geometry.coordinates[0]?.join(',')}:${route.destination?.shelterId ?? route.leg}`} route={route} position={native.location} target={requesterPoint} onInstruction={setCurrentInstruction} speak={voice.speak} reroute={() => { void requestRoute(route.leg); }} voiceEnabled={preferences.voiceEnabled && !soundFree} />}

    {active && <SessionCards a={a} token={token} userId={userId} onChatFocus={onChatFocus} />}

    {!soundFree && <ActionButton compact variant="secondary" label={c('readStatus')} onPress={() => { void voice.speak(statusText); }} />}
    {!terminal && (requester || session.helperUserId === userId) && <ActionButton variant="secondary" label={c('interrupt')} loading={state.busy} onPress={() => confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'))} />}
    {terminal && <ActionButton label={c('close')} onPress={state.dismissSession} />}
  </View> : <HelperSession a={a} token={token} userId={userId} banner={banner} onPrimaryLayout={onPrimaryLayout} onChatFocus={onChatFocus} stats={stats} />;
}

function HelperSession({ a, token, userId, banner, onPrimaryLayout, onChatFocus, stats }: { a: BuddyActions; token: string; userId: string; banner?: ReactNode; onPrimaryLayout?: (height: number) => void; onChatFocus?: () => void; stats: { label: string; value: string }[] }) {
  const { soundFree } = useAccess();
  const reduceMotion = useContext(SystemReduceMotionContext);
  const { state, c, status, support, preferences, session, active, partner, native, route, requesterPoint, routeBusy, wheelchair, setWheelchair, voice, statusText, confirm, catchNative, transition, requestRoute, setCurrentInstruction } = a;
  if (!session) return null;
  const terminal = terminalStatuses.has(session.status);
  const name = partner ?? c('name');
  const toRequester = session.status === 'ACCEPTED' || session.status === 'EN_ROUTE';
  const headline = session.status === 'ACCEPTED' ? c('stepReady', { name }) : session.status === 'EN_ROUTE' ? c('stepEnRoute', { name }) : session.status === 'ARRIVED' ? session.meetingConfirmed ? c('meetingConfirmed') : c('waitingMeeting') : session.status === 'EVACUATING' ? c('stepEvacuating') : status(session.status);
  const step = session.status === 'ACCEPTED' ? { label: c('depart'), action: 'depart' } : session.status === 'EN_ROUTE' ? { label: c('arrive'), action: 'arrive' } : session.status === 'ARRIVED' ? { label: c('pickup'), action: 'evacuating' } : session.status === 'EVACUATING' ? { label: c('complete'), action: 'report-complete' } : null;

  return <View style={{ gap: 16 }}>
    <View onLayout={event => onPrimaryLayout?.(Math.round(event.nativeEvent.layout.height))} style={{ gap: 14 }}>
      {banner}
      <View style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="eyebrow" style={{ color: colors.muted }}>{session.nearby ? c('gpsAssist') : c('buddyAssist')}</AppText>
        {active && <StatusChip dot tone="info" label={c('live')} />}
      </View>
      <AppText variant="title" accessibilityRole="header">{terminal ? headline : c('needsHelpTitle', { name })}</AppText>
      <View style={{ gap: 4 }}>
        <AppText variant="section" accessibilityLiveRegion="polite">{terminal ? name : headline}</AppText>
        {active && <AppText variant="small" style={{ color: colors.muted }}>{c('liveNote')}</AppText>}
      </View>
      {!terminal && <StatStrip items={stats} />}
      {state.locations.some(item => item.stale) && <AppText accessibilityRole="alert" variant="small" style={{ color: colors.caution }}>{c('stale')}</AppText>}
      {active && step && <Animated.View key={session.status} entering={reduceMotion ? undefined : FadeIn.duration(duration.state)}>
        <ActionButton label={step.label} disabled={session.status === 'ARRIVED' && !session.meetingConfirmed} loading={state.busy} onPress={() => { if (session.status === 'ACCEPTED') void transition(step.action); else confirm(step.label, () => { void transition(step.action); }); }} />
      </Animated.View>}
      {active && session.status === 'ARRIVED' && <ActionButton variant="secondary" label={c('complete')} loading={state.busy} onPress={() => confirm(c('complete'), () => { void transition('report-complete'); })} />}
      {active && <View style={buddyStyles.actions}>
        <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('callShort')} icon={<IconPhone size={18} color={colors.primary} />} onPress={() => catchNative(async () => { const contact = await buddyRequest<{ phone: string | null }>(token, `/requests/${session.id}/contact`); if (!contact.phone) throw new Error(c('noPhone')); await Linking.openURL(`tel:${encodeURIComponent(contact.phone)}`); })} /></View>
        <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={toRequester ? c('routeTo', { name: name.split(' ')[0] }) : c('toShelter')} icon={<IconRoute size={18} color={colors.primary} />} loading={routeBusy} onPress={() => { void requestRoute(toRequester ? 'TO_REQUESTER' : 'TO_SHELTER'); }} /></View>
      </View>}
    </View>

    {(session.supportNeeds.length > 0 || !!session.message) && <View style={{ gap: 10 }}>
      {session.supportNeeds.length > 0 && <View accessible accessibilityLabel={`${c('support')}: ${session.supportNeeds.map(support).join(', ')}`} style={[buddyStyles.row, { gap: 6, flexWrap: 'wrap' }]}>{session.supportNeeds.map(need => <StatusChip key={need} label={support(need)} />)}</View>}
      {!!session.message && <AppText selectable style={[buddyStyles.quote, { color: colors.muted }]}>“{session.message}”</AppText>}
    </View>}

    {active && route?.route && <RouteView key={`${session.id}:${route.route.geometry.coordinates[0]?.join(',')}:${route.destination?.shelterId ?? route.leg}`} route={route} title={route.leg === 'TO_REQUESTER' ? name : undefined} position={native.location} target={requesterPoint} onInstruction={setCurrentInstruction} speak={voice.speak} reroute={() => { void requestRoute(route.leg); }} voiceEnabled={preferences.voiceEnabled && !soundFree} />}

    {active && session.meetingConfirmed && <ShelterCard a={a} />}
    {active && !session.meetingConfirmed && <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />}

    {active && <SessionCards a={a} token={token} userId={userId} onChatFocus={onChatFocus} />}

    {!soundFree && <ActionButton compact variant="secondary" label={c('readStatus')} onPress={() => { void voice.speak(statusText); }} />}
    {!terminal && <ActionButton variant="secondary" label={c('interrupt')} loading={state.busy} onPress={() => confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'))} />}
    {terminal && <ActionButton label={c('close')} onPress={state.dismissSession} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  sheet: { backgroundColor: colors.canvas, ...corner(SHEET_RADIUS) },
  sheetFrame: { position: 'absolute', top: 0, left: SHEET_INSET, right: SHEET_INSET, bottom: SHEET_INSET, overflow: 'hidden', borderBottomLeftRadius: SHEET_RADIUS, borderBottomRightRadius: SHEET_RADIUS, borderCurve: 'continuous' },
  handle: { backgroundColor: colors.ink, opacity: 0.25, width: 40 },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  bubble: { gap: 2, padding: 12, alignSelf: 'flex-start', maxWidth: '88%', ...corner(radius.md), backgroundColor: colors.chip },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.selected },
});

function SessionCards({ a, token, userId, onChatFocus }: { a: BuddyActions; token: string; userId: string; onChatFocus?: () => void }) {
  const { state, c, language, partner, native, chat, setChat, catchNative, sendMessage, session } = a;
  const [messagesOpen, setMessagesOpen] = useState(false);
  if (!session) return null;
  return <>
    <Card>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: messagesOpen }} onPress={() => setMessagesOpen(open => !open)} style={[buddyStyles.row, { minHeight: 44, justifyContent: 'space-between' }]}>
        <AppText variant="section">{c('showMessages')}</AppText>
        <AppText variant="button" style={{ color: colors.primary, fontVariant: ['tabular-nums'] }}>{state.messages.length}</AppText>
      </Pressable>
      {messagesOpen && <View style={{ gap: 10 }}>
        {state.messages.map(item => <View key={item.id} style={[styles.bubble, item.userId === userId && styles.bubbleMine]}>
          <AppText variant="small" style={{ color: colors.muted }}>{item.userId === userId ? c('you') : partner ?? c('helper')} · {new Date(item.createdAt).toLocaleTimeString(language)}</AppText>
          <AppText selectable>{item.text}</AppText>
        </View>)}
        <View style={buddyStyles.actions}>
          <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('here')} onPress={() => { void sendMessage(c('here')); }} /></View>
          <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('wait')} onPress={() => { void sendMessage(c('wait')); }} /></View>
        </View>
        <Field accessibilityLabel={c('chat')} placeholder={c('chatPlaceholder')} value={chat} onChangeText={setChat} onFocus={onChatFocus} multiline maxLength={1000} />
        <ActionButton compact label={c('sendMessage')} disabled={!chat.trim()} loading={state.busy} onPress={() => { void sendMessage(chat); }} />
      </View>}
    </Card>

    <Card>
      <View style={buddyStyles.row}>
        <View style={[styles.dot, { backgroundColor: native.tracking ? colors.primary : colors.borderStrong }]} />
        <AppText style={buddyStyles.grow}>{native.tracking ? c('sharingOn') : c('sharingOff')}</AppText>
        <ActionButton compact variant="secondary" label={native.tracking ? c('stop') : c('start')} onPress={() => catchNative(native.tracking ? native.stopLocation : native.enableLocation)} />
      </View>
      {native.tracking && native.foregroundOnly && <AppText variant="small" style={{ color: colors.muted }}>{c('foregroundOnly')}</AppText>}
      {!state.locations.length && <AppText variant="small" style={{ color: colors.muted }}>{c('locationMissing')} · {c('locationHint')}</AppText>}
      <CheckOption label={c('phoneShare')} checked={session.phoneShared ?? false} onToggle={enabled => { void state.run(`/requests/${session.id}/phone-sharing`, { enabled }, 'PUT'); }} />
    </Card>
  </>;
}

function ShelterCard({ a }: { a: BuddyActions }) {
  const { c, requester, session, native, catchNative, wheelchair, setWheelchair, shelters, setShelters, selectedShelter, setSelectedShelter } = a;
  const loadShelters = () => catchNative(async () => { const position = await native.obtainLocation(); setShelters(await nearbyShelters(position)); });
  return <Card>
    <AppText variant="section" accessibilityRole="header">{c('chooseShelter')}</AppText>
    <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />
    <ActionButton compact variant="secondary" label={c('loadShelters')} onPress={loadShelters} />
    {shelters.map(shelter => <CheckOption key={shelter.id} label={shelter.name} description={requester ? undefined : shelter.source ?? c('routeUnknown')} checked={selectedShelter === shelter.id || (!selectedShelter && session?.selectedShelterId === shelter.id)} onToggle={() => setSelectedShelter(shelter.id)} />)}
  </Card>;
}
