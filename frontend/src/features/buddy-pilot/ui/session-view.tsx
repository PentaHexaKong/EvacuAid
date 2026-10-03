import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, CheckOption, Field } from '@/components/ui';
import { DiscoverMap } from '@/components/discover-map.native';
import { colors, corner, radius } from '@/theme';
import { relativeTime } from '@/features/hazards/time';
import { nearbyShelters } from '@/features/navigation/api';
import { buddyRequest, terminalStatuses } from '../api';
import { distanceM } from '../navigation';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, StatStrip, StatusChip } from './parts';
import { RouteView } from './route-view';

export function SessionView({ a, token, userId }: { a: BuddyActions; token: string; userId: string }) {
  const { state, c, status, support, language, preferences, session, active, requester, partner, native, route, helperRoute, requesterPoint, routeBusy, wheelchair, setWheelchair, shelters, setShelters, selectedShelter, setSelectedShelter, chat, setChat, consent, setConsent, voice, statusText, confirm, catchNative, transition, startNearby, requestRoute, sendMessage, setCurrentInstruction } = a;
  const { t } = useTranslation();
  const [messagesOpen, setMessagesOpen] = useState(false);
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
  const loadShelters = () => catchNative(async () => { const position = await native.obtainLocation(); setShelters(await nearbyShelters(position)); });

  return <View style={{ gap: 16 }}>
    <View style={{ gap: 6 }}>
      <View style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="eyebrow" style={{ color: colors.muted }}>{session.nearby ? c('gpsAssist') : c('buddyAssist')}</AppText>
        {active && <StatusChip dot tone="info" label={c('live')} />}
      </View>
      {requester
        ? (partner ? <><AppText variant="small" style={{ color: colors.muted }}>{c('helper')}</AppText><AppText variant="title" accessibilityRole="header">{partner}</AppText></> : null)
        : <AppText variant="title" accessibilityRole="header">{c('needsHelpTitle', { name: partner ?? c('name') })}</AppText>}
    </View>

    {active && native.location && <View style={styles.map}>
      <DiscoverMap items={state.locations.filter(item => item.userId !== userId && !item.stale).map(item => ({ id: item.userId, title: partner ?? c('helper'), kind: 'destination' as const, coordinate: item }))} selected={null} onSelect={() => {}} route={requester ? helperRoute?.route?.geometry.coordinates : route?.leg === 'TO_REQUESTER' && !requesterPoint ? undefined : route?.route?.geometry.coordinates} userLocation={native.location} onLocate={() => catchNative(native.obtainLocation)} topInset={0} bottomInset={0} />
    </View>}

    <Card tint={active ? 'info' : undefined}>
      <AppText variant="section" accessibilityLiveRegion="polite">{headline}</AppText>
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

    {active && !requester && <View style={{ gap: 10 }}>
      {session.status === 'ACCEPTED' && <ActionButton label={c('depart')} loading={state.busy} onPress={() => { void transition('depart'); }} />}
      {session.status === 'EN_ROUTE' && <ActionButton label={c('arrive')} loading={state.busy} onPress={() => confirm(c('arrive'), () => { void transition('arrive'); })} />}
      {session.status === 'ARRIVED' && <AppText style={{ color: colors.muted }}>{session.meetingConfirmed ? c('meetingConfirmed') : c('waitingMeeting')}</AppText>}
      {session.status === 'ARRIVED' && <ActionButton label={c('pickup')} disabled={!session.meetingConfirmed} loading={state.busy} onPress={() => confirm(c('pickup'), () => { void transition('evacuating'); })} />}
      {['ARRIVED', 'EVACUATING'].includes(session.status) && <ActionButton variant="secondary" label={c('complete')} loading={state.busy} onPress={() => confirm(c('complete'), () => { void transition('report-complete'); })} />}
    </View>}
    {active && requester && session.status === 'ARRIVED' && !session.meetingConfirmed && <ActionButton label={c('meet')} loading={state.busy} onPress={() => confirm(c('meet'), () => { void transition('confirm-meeting'); })} />}
    {active && requester && session.status === 'COMPLETION_PENDING' && <ActionButton label={c('confirmComplete')} loading={state.busy} onPress={() => confirm(c('confirmComplete'), () => { void transition('confirm-complete'); })} />}

    {active && <View style={buddyStyles.actions}>
      <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('call')} onPress={() => catchNative(async () => { const contact = await buddyRequest<{ phone: string | null }>(token, `/requests/${session.id}/contact`); if (!contact.phone) throw new Error(c('noPhone')); await Linking.openURL(`tel:${encodeURIComponent(contact.phone)}`); })} /></View>
      {(!requester || session.meetingConfirmed) && <View style={buddyStyles.grow}><ActionButton compact label={!requester && toRequester ? c('toRequester') : c('toShelter')} loading={routeBusy} onPress={() => { void requestRoute(!requester && toRequester ? 'TO_REQUESTER' : 'TO_SHELTER'); }} /></View>}
    </View>}

    {active && session.meetingConfirmed && <Card>
      <AppText variant="section" accessibilityRole="header">{c('chooseShelter')}</AppText>
      <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />
      <ActionButton compact variant="secondary" label={c('loadShelters')} onPress={loadShelters} />
      {shelters.map(shelter => <CheckOption key={shelter.id} label={shelter.name} description={requester ? undefined : shelter.source ?? c('routeUnknown')} checked={selectedShelter === shelter.id || (!selectedShelter && session.selectedShelterId === shelter.id)} onToggle={() => setSelectedShelter(shelter.id)} />)}
    </Card>}
    {active && !session.meetingConfirmed && !requester && <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />}

    {active && route?.route && <RouteView key={`${session.id}:${route.route.geometry.coordinates[0]?.join(',')}:${route.destination?.shelterId ?? route.leg}`} route={route} position={native.location} target={requesterPoint} onInstruction={setCurrentInstruction} speak={voice.speak} reroute={() => { void requestRoute(route.leg); }} voiceEnabled={preferences.voiceEnabled} />}

    {active && <Card>
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
        <Field accessibilityLabel={c('chat')} placeholder={c('chatPlaceholder')} value={chat} onChangeText={setChat} multiline maxLength={1000} />
        <ActionButton compact label={c('sendMessage')} disabled={!chat.trim()} loading={state.busy} onPress={() => { void sendMessage(chat); }} />
      </View>}
    </Card>}

    {active && <Card>
      <View style={buddyStyles.row}>
        <View style={[styles.dot, { backgroundColor: native.tracking ? colors.primary : colors.borderStrong }]} />
        <AppText style={buddyStyles.grow}>{native.tracking ? c('sharingOn') : c('sharingOff')}</AppText>
        <ActionButton compact variant="secondary" label={native.tracking ? c('stop') : c('start')} onPress={() => catchNative(native.tracking ? native.stopLocation : native.enableLocation)} />
      </View>
      {!state.locations.length && <AppText variant="small" style={{ color: colors.muted }}>{c('locationMissing')} · {c('locationHint')}</AppText>}
      <CheckOption label={c('phoneShare')} checked={session.phoneShared ?? false} onToggle={enabled => { void state.run(`/requests/${session.id}/phone-sharing`, { enabled }, 'PUT'); }} />
    </Card>}

    <ActionButton compact variant="secondary" label={c('readStatus')} onPress={() => { void voice.speak(statusText); }} />
    {!terminal && (requester || session.helperUserId === userId) && <ActionButton variant="secondary" label={c('interrupt')} loading={state.busy} onPress={() => confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'))} />}
    {terminal && <ActionButton label={c('close')} onPress={state.dismissSession} />}
  </View>;
}

const styles = StyleSheet.create({
  map: { height: 280, ...corner(radius.lg), overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  bubble: { gap: 2, padding: 12, alignSelf: 'flex-start', maxWidth: '88%', ...corner(radius.md), backgroundColor: colors.chip },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.selected },
});
