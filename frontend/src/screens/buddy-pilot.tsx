import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Linking, Share, Switch, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ActionButton, AppText, CheckOption, Field, Page, Panel } from '@/components/ui';
import { SectionTitle } from '@/components/content';
import { DiscoverMap } from '@/components/discover-map.native';
import { useGuestSession } from '@/features/profile/session';
import { useProfile } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { buddyRequest, sharingStatuses, terminalStatuses, type BuddyRoute, type Invitation, type Position, type Session } from '@/features/buddy-pilot/api';
import { useBuddyPilot } from '@/features/buddy-pilot/use-buddy-pilot';
import type { ApiError } from '@/features/profile/api';
import { useBuddyNative, useBuddySpeech } from '@/features/buddy-pilot/native';
import { useBuddyCopy } from '@/features/buddy-pilot/copy';
import { nearbyShelters, type Shelter } from '@/features/navigation/api';
import { distanceM, routeProgress } from '@/features/buddy-pilot/navigation';
import { colors, corner, radius } from '@/theme';

export function BuddyPilotScreen() {
  const { token, user } = useGuestSession();
  const state = useBuddyPilot(token);
  const { c } = useBuddyCopy();
  if (!token || !user) return <Page><AppText accessibilityRole="alert">{c('requestFailed')}</AppText></Page>;
  if (state.loading) return <Page><ActivityIndicator accessibilityLabel={c('checking')} /></Page>;
  return <BuddyContent key={user.id} token={token} userId={user.id} state={state} />;
}

function BuddyContent({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddyPilot> }) {
  const { c, status, language, support, event } = useBuddyCopy();
  const { accessibility } = useProfile();
  const { preferences } = usePreferences();
  const params = useLocalSearchParams<{ code?: string; requestId?: string }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (state.session?.status !== 'WAITING') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [state.session?.status]);
  const [codeInput, setCodeInput] = useState({ source: params.code, value: params.code ?? '' });
  const code = codeInput.source === params.code ? codeInput.value : params.code ?? '';
  const setCode = (value: string) => setCodeInput({ source: params.code, value });
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [enrollment, setEnrollment] = useState('');
  const [helper, setHelper] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [chat, setChat] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [routeResult, setRoute] = useState<{ sessionId: string; value: BuddyRoute } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [selectedShelter, setSelectedShelter] = useState<string | undefined>();
  const currentInstruction = useRef('');
  const chatKey = useRef<{ text: string; key: string } | null>(null);
  const [wheelchair, setWheelchair] = useState(accessibility.some(item => item.type === 'MOBILITY_LIMITATION'));
  const idempotency = useRef<string | null>(null);
  const session = state.session;
  const active = state.error && !session ? undefined : Boolean(session && sharingStatuses.has(session.status));
  const route = routeResult?.sessionId === session?.id && (!session?.selectedShelterId || routeResult?.value.leg === 'TO_REQUESTER' || routeResult?.value.destination?.shelterId === session.selectedShelterId) ? routeResult?.value : null;
  const requesterPoint = state.locations.find(item => item.userId === session?.requesterUserId && !item.stale && item.accuracyM <= 30) ?? null;
  const requester = session?.requesterUserId === userId;
  const native = useBuddyNative({ token, sessionId: session?.id ?? null, active, language: language.startsWith('id') ? 'id' : 'en', onRefresh: id => { void state.refresh(id); } });
  const partner = requester ? session?.helperName : session?.requesterName;
  const partnerLocation = state.locations.find(item => item.userId !== userId);
  const statusText = [session ? status(session.status) : c('empty'), partner, partnerLocation ? `${c('updated')}: ${new Date(partnerLocation.observedAt).toLocaleTimeString(language)}. ${partnerLocation.stale ? c('stale') : native.location ? `${Math.round(distanceM(native.location, partnerLocation))} m` : ''}` : session && active ? c('locationMissing') : ''].filter(Boolean).join('. ');
  const confirm = (label: string, action: () => void, body = label) => Alert.alert(label, body, [{ text: c('cancel'), style: 'cancel' }, { text: c('yes'), onPress: action }]);
  const catchNative = (action: () => Promise<unknown>) => { setLocalError(null); void action().catch(cause => setLocalError(cause instanceof Error ? cause.message : c('requestFailed'))); };
  const transition = async (action: string, body: unknown = {}) => {
    if (!session) return;
    const result = await state.run<Session>(`/requests/${session.id}/${action}`, body);
    if (result) { if (action === 'decline') state.dismissSession(); else await state.refresh(result.id); }
  };
  const voice = useBuddySpeech({ language: language.startsWith('id') ? 'id' : 'en', onCommand: transcript => {
    const command = transcript.toLocaleLowerCase();
    if (/status|posisi/.test(command)) void voice.speak(statusText);
    else if (/ulang|repeat/.test(command)) void voice.speak(route ? currentInstruction.current || c('noRoute') : c('noRoute'));
    else if (/batal|akhiri|cancel|end/.test(command) && session) confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'));
    else if (/selesai|complete/.test(command) && session?.status === 'COMPLETION_PENDING' && requester) confirm(c('confirmComplete'), () => { void transition('confirm-complete'); });
    else if (/terdekat|nearby/.test(command)) confirm(c('nearby'), () => { void startNearby(true); }, `${c('nearbyExplanation')} ${c('consent')}`);
    else if (/bantuan|help/.test(command) && !session) { const target = helper ?? state.contacts.find(item => item.level === 'PRIMARY')?.buddyUserId; if (target) confirm(c('send'), () => { void sendRequest(target, true); }, c('consent')); else void voice.speak(c('empty')); }
    else void voice.speak(c('unknownCommand'));
  } });
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!session || lastStatus.current === `${session.id}:${session.status}`) return;
    lastStatus.current = `${session.id}:${session.status}`;
    if (preferences.voiceEnabled) void voice.speak(status(session.status));
    else AccessibilityInfo.announceForAccessibility(status(session.status));
  }, [session, preferences.voiceEnabled, status, voice]);
  const refreshState = state.refresh;
  useEffect(() => { if (params.requestId) void refreshState(params.requestId); }, [params.requestId, refreshState]);
  const availabilityPosition = useEffectEvent(() => native.obtainLocation());
  const availabilityFailure = useEffectEvent((cause: unknown) => {
    if ((cause as ApiError)?.status === 409) { void refreshState(); return; }
    setLocalError(cause instanceof Error ? cause.message : c('locationMissing'));
  });
  useEffect(() => {
    if (!state.availability?.optedIn) return;
    let pending = false;
    let cancelled = false;
    const refresh = async () => {
      if (pending || AppState.currentState !== 'active') return;
      pending = true;
      try { const position = await availabilityPosition(); if (!cancelled) await buddyRequest(token, '/availability', 'PUT', { optedIn: true, refreshOnly: true, ...position }); }
      catch (cause) { if (!cancelled) availabilityFailure(cause); }
      finally { pending = false; }
    };
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [state.availability?.optedIn, token]);

  const sendRequest = async (target = helper, voiceConfirmed = false) => {
    if ((!consent && !voiceConfirmed) || (!message.trim() && !voiceConfirmed) || !target) { setLocalError(c('consentRequired')); return; }
    idempotency.current ??= `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await state.run<Session>('/requests', { helperUserId: target, message: message.trim() || c('request'), supportNeeds: accessibility.map(item => item.type), sharingConsent: true, idempotencyKey: idempotency.current });
    if (result) { idempotency.current = null; setHelper(null); setMessage(''); await state.refresh(result.id); }
  };
  const startNearby = async (voiceConfirmed = false) => {
    if (!consent && !voiceConfirmed) { setLocalError(c('consentRequired')); return; }
    try {
      const position = await native.obtainLocation();
      if (session && !terminalStatuses.has(session.status)) { await transition('nearby', position); return; }
      idempotency.current ??= `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const created = await state.run<Session>('/requests', { helperUserId: null, message: message.trim() || c('request'), supportNeeds: accessibility.map(item => item.type), sharingConsent: true, idempotencyKey: idempotency.current, ...position });
      if (created) {
        idempotency.current = null;
        await state.run(`/requests/${created.id}/nearby`, position);
        await state.refresh(created.id);
      }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : c('locationMissing')); }
  };
  const requestRoute = async (leg: 'TO_REQUESTER' | 'TO_SHELTER', position?: Position) => {
    if (!session || routeBusy) return;
    setRouteBusy(true); setLocalError(null);
    try {
      if (!native.tracking) await native.enableLocation();
      const origin = position ?? await native.obtainLocation();
      const result = await buddyRequest<BuddyRoute>(token, `/requests/${session.id}/route`, 'POST', { leg, profile: wheelchair ? 'WHEELCHAIR' : 'WALKING', origin, destinationShelterId: selectedShelter ?? session.selectedShelterId ?? undefined });
      setRoute({ sessionId: session.id, value: result });
      if (result.routeStatus !== 'READY') setLocalError(c('noRoute'));
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : c('noRoute')); }
    finally { setRouteBusy(false); }
  };
  const sendMessage = async (text: string) => {
    if (!session || !text.trim()) return;
    if (chatKey.current?.text !== text.trim()) chatKey.current = { text: text.trim(), key: `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}` };
    if (await state.run(`/requests/${session.id}/messages`, { text: text.trim(), idempotencyKey: chatKey.current.key })) { setChat(''); chatKey.current = null; }
  };
  const attempt = session?.attempts.find(item => item.helperUserId === userId && item.status === 'PENDING' && Date.parse(item.expiresAt) > now && session?.status === 'WAITING');
  const issue = state.error ?? localError ?? native.error ?? voice.error;

  return <Page keyboard>
    <SectionTitle>{c('title')}</SectionTitle>
      <ActionButton variant="secondary" label={voice.listening ? c('listening') : c('listen')} onPress={() => { if (voice.listening) voice.stopListening(); else void voice.startListening(); }} />
    {issue && <Panel><AppText accessibilityRole="alert" style={{ color: colors.critical }}>{issue}</AppText><ActionButton variant="secondary" label={c('retry')} onPress={() => { setLocalError(null); void state.refresh(); }} /></Panel>}
    <ActionButton variant="secondary" label={c('notifications')} onPress={() => catchNative(native.enableNotifications)} />
    {session ? <>
      <Panel>{(partner || !requester) && <><AppText variant="small">{requester ? c('helper') : c('requester')}</AppText><SectionTitle>{partner ?? c('name')}</SectionTitle></>}<AppText accessibilityLiveRegion="polite" variant="title">{status(session.status)}</AppText><AppText selectable>{session.message}</AppText>{session.supportNeeds.length > 0 && <AppText>{c('support')}: {session.supportNeeds.map(support).join(', ')}</AppText>}</Panel>
      <ActionButton variant="secondary" label={c('readStatus')} onPress={() => { void voice.speak(statusText); }} />

      {attempt && <Panel><CheckOption label={c('consent')} checked={consent} onToggle={setConsent} /><ActionButton label={c('accept')} disabled={!consent} loading={state.busy} onPress={() => { void transition('accept', { attemptId: attempt.id, sharingConsent: true }); }} /><ActionButton variant="secondary" label={c('decline')} loading={state.busy} onPress={() => { void transition('decline', { attemptId: attempt.id }); }} /></Panel>}
      {requester && ['FALLBACK_REQUIRED', 'UNANSWERED'].includes(session.status) && <Panel><AppText>{c('requestFailed')}</AppText><CheckOption label={c('consent')} checked={consent} onToggle={setConsent} /><ActionButton label={c('nearby')} loading={state.busy} onPress={() => confirm(c('nearby'), () => { void startNearby(); }, c('nearbyExplanation'))} /><ActionButton variant="secondary" label={c('close')} onPress={() => { if (!terminalStatuses.has(session.status)) void transition('interrupt'); else state.dismissSession(); }} /></Panel>}
      {active && <>
        <Panel><SectionTitle>{c('locationAge')}</SectionTitle>{state.locations.map(item => <View key={item.userId} style={{ gap: 4 }}><AppText>{item.userId === userId ? c('you') : partner ?? c('helper')}</AppText><AppText variant="small">{new Date(item.observedAt).toLocaleTimeString(language)}</AppText>{item.stale && <AppText accessibilityRole="alert">{c('stale')}</AppText>}</View>)}{!state.locations.length && <AppText>{c('locationMissing')}</AppText>}<AppText variant="small">{c('locationHint')}</AppText><ActionButton variant="secondary" label={c('tracking')} disabled={native.tracking} onPress={() => catchNative(native.enableLocation)} /><ActionButton variant="secondary" label={c('stopTracking')} onPress={() => catchNative(native.stopLocation)} /></Panel>
        {native.location && <View style={{ height: 260, ...corner(radius.lg), overflow: 'hidden' }}><DiscoverMap items={state.locations.filter(item => item.userId !== userId && !item.stale).map(item => ({ id: item.userId, title: partner ?? c('helper'), kind: 'destination' as const, coordinate: item }))} selected={null} onSelect={() => {}} route={route?.leg === 'TO_REQUESTER' && !requesterPoint ? undefined : route?.route?.geometry.coordinates} userLocation={native.location} onLocate={() => catchNative(native.obtainLocation)} topInset={0} bottomInset={0} /></View>}
        {!requester && <Panel>
          {session.status === 'ACCEPTED' && <ActionButton label={c('depart')} loading={state.busy} onPress={() => { void transition('depart'); }} />}
          {session.status === 'EN_ROUTE' && <ActionButton label={c('arrive')} loading={state.busy} onPress={() => confirm(c('arrive'), () => { void transition('arrive'); })} />}
          {session.status === 'ARRIVED' && <ActionButton label={c('pickup')} disabled={!session.meetingConfirmed} loading={state.busy} onPress={() => confirm(c('pickup'), () => { void transition('evacuating'); })} />}
          {['ARRIVED', 'EVACUATING'].includes(session.status) && <ActionButton label={c('complete')} loading={state.busy} onPress={() => confirm(c('complete'), () => { void transition('report-complete'); })} />}
          {session.status === 'ARRIVED' && <AppText>{session.meetingConfirmed ? c('meetingConfirmed') : c('waitingMeeting')}</AppText>}
          {session.meetingConfirmed && <><ActionButton variant="secondary" label={c('loadShelters')} onPress={() => catchNative(async () => { const position = await native.obtainLocation(); setShelters(await nearbyShelters(position)); })} />{shelters.map(shelter => <CheckOption key={shelter.id} label={shelter.name} description={shelter.source ?? c('routeUnknown')} checked={selectedShelter === shelter.id || (!selectedShelter && session.selectedShelterId === shelter.id)} onToggle={() => setSelectedShelter(shelter.id)} />)}</>}
          <CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} />
          <ActionButton variant="secondary" label={session.status === 'ACCEPTED' || session.status === 'EN_ROUTE' ? c('toRequester') : c('toShelter')} loading={routeBusy} onPress={() => { void requestRoute(session.status === 'ACCEPTED' || session.status === 'EN_ROUTE' ? 'TO_REQUESTER' : 'TO_SHELTER'); }} />
        </Panel>}
        {requester && session.status === 'ARRIVED' && !session.meetingConfirmed && <ActionButton label={c('meet')} loading={state.busy} onPress={() => confirm(c('meet'), () => { void transition('confirm-meeting'); })} />}
        {requester && session.status === 'COMPLETION_PENDING' && <ActionButton label={c('confirmComplete')} loading={state.busy} onPress={() => confirm(c('confirmComplete'), () => { void transition('confirm-complete'); })} />}
        {requester && session.meetingConfirmed && <Panel><CheckOption label={c('wheelchair')} checked={wheelchair} onToggle={setWheelchair} /><ActionButton variant="secondary" label={c('loadShelters')} onPress={() => catchNative(async () => { const position = await native.obtainLocation(); setShelters(await nearbyShelters(position)); })} />{shelters.map(shelter => <CheckOption key={shelter.id} label={shelter.name} checked={selectedShelter === shelter.id || (!selectedShelter && session.selectedShelterId === shelter.id)} onToggle={() => setSelectedShelter(shelter.id)} />)}<ActionButton label={c('toShelter')} loading={routeBusy} onPress={() => { void requestRoute('TO_SHELTER'); }} /></Panel>}
        {route?.route && <NavigationPanel key={`${session.id}:${route.route.geometry.coordinates[0]?.join(',')}:${route.destination?.shelterId ?? route.leg}`}  route={route} position={native.location} target={requesterPoint} onInstruction={instruction => { currentInstruction.current = instruction; }} speak={voice.speak} reroute={() => { void requestRoute(route.leg); }} voiceEnabled={preferences.voiceEnabled} />}
        <Panel><SectionTitle>{c('chat')}</SectionTitle>{state.messages.map(item => <View key={item.id} style={{ gap: 4 }}><AppText variant="small">{item.userId === userId ? c('you') : partner ?? c('helper')} · {new Date(item.createdAt).toLocaleTimeString(language)}</AppText><AppText selectable>{item.text}</AppText></View>)}<Field accessibilityLabel={c('chat')} placeholder={c('chatPlaceholder')} value={chat} onChangeText={setChat} multiline maxLength={1000} /><ActionButton label={c('sendMessage')} disabled={!chat.trim()} loading={state.busy} onPress={() => { void sendMessage(chat); }} /><ActionButton variant="secondary" label={c('here')} onPress={() => { void sendMessage(c('here')); }} /><ActionButton variant="secondary" label={c('wait')} onPress={() => { void sendMessage(c('wait')); }} /></Panel>
        <CheckOption label={c('phoneShare')} checked={session.phoneShared ?? false} onToggle={enabled => { void state.run(`/requests/${session.id}/phone-sharing`, { enabled }, 'PUT'); }} />
        <ActionButton variant="secondary" label={c('call')} onPress={() => catchNative(async () => { const contact = await buddyRequest<{ phone: string | null }>(token, `/requests/${session.id}/contact`); if (!contact.phone) throw new Error(c('noPhone')); await Linking.openURL(`tel:${encodeURIComponent(contact.phone)}`); })} />
      </>}
      {!terminalStatuses.has(session.status) && (requester || session.helperUserId === userId) && <ActionButton variant="secondary" label={c('interrupt')} loading={state.busy} onPress={() => confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'))} />}
      {terminalStatuses.has(session.status) && <ActionButton label={c('close')} onPress={state.dismissSession} />}
    </> : <>
      <SectionTitle>{c('trusted')}</SectionTitle>
      {!state.contacts.length && <AppText>{c('empty')}</AppText>}
      {state.contacts.map(contact => <Panel key={contact.id}><SectionTitle>{contact.name ?? c('name')}</SectionTitle><AppText>{contact.available ? c('availableNow') : c('unavailableNow')}</AppText>{contact.observedAt && <AppText variant="small">{c('updated')}: {new Date(contact.observedAt).toLocaleTimeString(language)}</AppText>}{contact.level === 'PRIMARY' && <AppText variant="small">{c('primaryLabel')}</AppText>}<ActionButton label={c('request')} onPress={() => { setHelper(contact.buddyUserId); idempotency.current = null; }} /><ActionButton variant="secondary" label={c('remove')} onPress={() => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); })} />{contact.level !== 'PRIMARY' && <ActionButton variant="secondary" label={c('primary')} onPress={() => { void state.run(`/contacts/${contact.id}/primary`, {}); }} />}</Panel>)}
      {helper && <Panel><SectionTitle>{c('request')}</SectionTitle><Field accessibilityLabel={c('message')} placeholder={c('message')} value={message} onChangeText={setMessage} multiline maxLength={1000} /><CheckOption label={c('consent')} checked={consent} onToggle={setConsent} /><ActionButton label={c('send')} loading={state.busy} onPress={() => { void sendRequest(); }} /><ActionButton variant="secondary" label={c('cancel')} onPress={() => setHelper(null)} /></Panel>}
      {state.incomingContacts?.length > 0 && <><SectionTitle>{c('supporting')}</SectionTitle>{state.incomingContacts.map(contact => <Panel key={contact.id}><AppText>{contact.name ?? c('name')}</AppText><ActionButton variant="secondary" label={c('remove')} onPress={() => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); })} /></Panel>)}</>}
      <Panel><SectionTitle>{c('nearby')}</SectionTitle><AppText>{c('nearbyExplanation')}</AppText><CheckOption label={c('consent')} checked={consent} onToggle={setConsent} /><ActionButton label={c('nearby')} loading={state.busy} onPress={() => confirm(c('nearby'), () => { void startNearby(); }, c('nearbyExplanation'))} /></Panel>
      <Panel><SectionTitle>{c('add')}</SectionTitle><AppText>{c('inviteExplanation')}</AppText><AppText selectable>{c('you')}: {userId.slice(-8)}</AppText><ActionButton label={c('create')} loading={state.busy} onPress={() => { void state.run<Invitation>('/invitations', {}).then(result => { if (result) setInvite(result); }); }} />{invite?.code && <><AppText selectable>{invite.code}</AppText><ActionButton variant="secondary" label={c('share')} onPress={() => { void Share.share({ message: `EvacuAid Buddy: evacuaid://buddy-invite?code=${encodeURIComponent(invite.code!)}` }); }} /></>}<Field accessibilityLabel={c('code')} placeholder={c('code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} /><ActionButton variant="secondary" label={c('redeem')} loading={state.busy} disabled={!code.trim()} onPress={() => { void state.run('/invitations/redeem', { code: code.trim() }).then(result => { if (result) setCode(''); }); }} />{state.invitations.filter(item => ['PENDING', 'REDEEMED'].includes(item.status)).map(item => <View key={item.id} style={{ gap: 12 }}><AppText>{item.redeemerName ?? c('pending')}{item.redeemerUserId ? ` · ${item.redeemerUserId.slice(-8)}` : ''}</AppText><AppText variant="small">{new Date(item.expiresAt).toLocaleString(language)}</AppText>{item.status === 'REDEEMED' && <ActionButton label={c('confirmPerson')} onPress={() => confirm(c('confirmPerson'), () => { void state.run(`/invitations/${item.id}/confirm`, {}); }, `${item.redeemerName ?? c('name')} · ${item.redeemerUserId?.slice(-8) ?? ''}`)} />}<ActionButton variant="secondary" label={c('revoke')} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} /></View>)}</Panel>
      <Panel><View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}><AppText style={{ flex: 1 }}>{c('available')}</AppText><Switch accessibilityLabel={c('available')} value={state.availability?.optedIn ?? false} disabled={state.busy} onValueChange={optedIn => catchNative(async () => { const position = optedIn ? await native.obtainLocation() : {}; await state.run('/availability', { optedIn, ...position }, 'PUT'); })} /></View><AppText variant="small">{c('availabilityExplanation')}</AppText>{state.availability?.enrolled ? <AppText>{c('enrolled')}</AppText> : <><Field accessibilityLabel={c('pilotCode')} placeholder={c('pilotCode')} value={enrollment} onChangeText={setEnrollment} secureTextEntry /><AppText variant="small">{c('enrollmentInfo')}</AppText><ActionButton variant="secondary" label={c('enroll')} disabled={!enrollment.trim()} loading={state.busy} onPress={() => { void state.run('/enrollment', { code: enrollment }).then(result => { if (result) setEnrollment(''); }); }} /></>}</Panel>
    </>}
    <SectionTitle>{c('inbox')}</SectionTitle>
    {!state.inbox.length && <AppText>{c('inboxEmpty')}</AppText>}
    {state.inbox.map(item => <Panel key={item.id}><AppText>{item.payload.status ? status(item.payload.status) : event(item.kind)}</AppText><AppText variant="small">{new Date(item.createdAt).toLocaleString(language)} · {item.read ? c('read') : c('unread')}</AppText><ActionButton variant="secondary" label={c('open')} onPress={() => { void state.run(`/inbox/${item.id}/read`, {}).then(() => { if (item.requestId) void state.refresh(item.requestId); }); }} /></Panel>)}
  </Page>;
}

function NavigationPanel({ route, position, target, onInstruction, speak, reroute, voiceEnabled }: { route: BuddyRoute; position: Position | null; target: Position | null; onInstruction: (instruction: string) => void; speak: (text: string) => Promise<void>; reroute: () => void; voiceEnabled: boolean }) {
  const { c } = useBuddyCopy();
  const [progress, setProgress] = useState<ReturnType<typeof routeProgress>>(null);
  const offRoute = useRef({ count: 0, lastFix: '', lastReroute: 0 });
  const spoken = useRef('');
  const previous = useRef<{ route: BuddyRoute; segment: number }>({ route, segment: 0 });
  useEffect(() => {
    const update = () => {
      const next = position && route.route && (route.leg !== 'TO_REQUESTER' || target) ? routeProgress(position, route.route.geometry.coordinates, route.route.maneuvers, Date.now(), previous.current.route === route ? previous.current.segment : 0) : null;
      if (next) previous.current = { route, segment: next.segmentIndex };
      setProgress(next);
    };
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [route, position, target]);
  const maneuver = progress ? route.route?.maneuvers[progress.maneuverIndex] : null;
  useEffect(() => {
    if (!progress) { offRoute.current.count = 0; onInstruction(c('stale')); return; }
    onInstruction(maneuver?.instruction ?? c('stale'));
    if (route.leg === 'TO_REQUESTER' && target && route.destination && Date.now() - Date.parse(target.observedAt) <= 30000 && target.accuracyM <= 30 && distanceM(target, route.destination) > 30 && Date.now() - offRoute.current.lastReroute >= 15000) { offRoute.current.lastReroute = Date.now(); offRoute.current.count = 0; reroute(); return; }
    if (!position || offRoute.current.lastFix === position.observedAt) return;
    offRoute.current.lastFix = position.observedAt;
    offRoute.current.count = progress.offRouteM > 30 ? offRoute.current.count + 1 : 0;
    if (offRoute.current.count >= 3 && Date.now() - offRoute.current.lastReroute >= 15000) { offRoute.current.count = 0; offRoute.current.lastReroute = Date.now(); reroute(); }
    if (maneuver && progress.offRouteM <= 30 && spoken.current !== `${maneuver.beginShapeIndex}:${maneuver.instruction}`) { spoken.current = `${maneuver.beginShapeIndex}:${maneuver.instruction}`; if (voiceEnabled) void speak(maneuver.instruction); }
  }, [route, progress, position, target, maneuver, onInstruction, c, reroute, speak, voiceEnabled]);
  return <Panel><SectionTitle>{route.destination?.name ?? c('instructions')}</SectionTitle><AppText variant="small">{c('routeUnknown')}</AppText>{progress ? <><AppText style={{ fontVariant: ['tabular-nums'] }}>{Math.round(progress.remainingM)} m · {c('eta')}: {Math.max(1, Math.ceil((route.route!.durationSec * progress.remainingM / Math.max(1, route.route!.distanceM)) / 60))} {c('minutes')}</AppText><AppText variant="title">{maneuver?.instruction ?? c('instructions')}</AppText>{progress.nearDestination && <AppText>{c('nearDestination')}</AppText>}</> : <AppText accessibilityRole="alert">{c('stale')}</AppText>}<ActionButton variant="secondary" label={c('repeat')} onPress={() => { void speak(maneuver?.instruction ?? c('stale')); }} /><ActionButton variant="secondary" label={c('reroute')} onPress={reroute} />{route.route?.maneuvers.map((item, index) => <AppText key={`${index}:${item.beginShapeIndex}`}>{index + 1}. {item.instruction}</AppText>)}</Panel>;
}
