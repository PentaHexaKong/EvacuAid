import { useAccess } from '@/features/access/use-access';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import { confirmCommand } from '@/features/voice/confirm-command';
import { useVoicePrompt } from '@/features/voice/use-voice-prompt';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { useBeacons } from './use-beacons';
import { useProfile } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { buddyRequest, sharingStatuses, terminalStatuses, type BuddyRoute, type Position, type Session } from '@/features/buddy/api';
import type { useBuddy } from '@/features/buddy/use-buddy';
import type { ApiError } from '@/features/profile/api';
import { useBuddyNative, useBuddySpeech } from '@/features/buddy/native';
import { readableIssue, useBuddyCopy } from '@/features/buddy/copy';
import type { Shelter } from '@/features/navigation/api';
import { distanceM } from '@/features/buddy/navigation';
import { usesMapbox } from '@/components/map-engine';
import { CUE_M, useRouteGuidance } from '@/features/buddy/use-route-guidance';

export function useBuddyActions({ token, userId, state, manageBackground = true, autoSearch = false }: { token: string; userId: string; state: ReturnType<typeof useBuddy>; manageBackground?: boolean; autoSearch?: boolean }) {
  const { c, status, language, support, event } = useBuddyCopy();
  const focused = useIsFocused();
  const [localSos, setLocalSos] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const sosWanted = useRef(false);
  const sosGeneration = useRef(0);
  const pendingNearby = useRef<string | null>(null);
  const cancelReason = useRef<'cancel' | 'session'>('cancel');
  const cancelledBySession = () => cancelReason.current === 'session';
  const interruptedNearby = useRef(new Set<string>());
  const interruptNearby = async (id: string) => {
    if (interruptedNearby.current.has(id)) return;
    interruptedNearby.current.add(id);
    try { await buddyRequest(token, `/requests/${id}/interrupt`, 'POST', {}); }
    catch (cause) { interruptedNearby.current.delete(id); throw cause; }
  };
  const cancelNearby = (reason: 'cancel' | 'session' = 'cancel') => { if (reason === 'cancel' && pendingNearby.current) void interruptNearby(pendingNearby.current).catch(() => {}); cancelReason.current = reason; sosWanted.current = false; sosGeneration.current++; pendingNearby.current = null; idempotency.current = null; setLocalSos(false); };
  useEffect(() => { cancelNearby(); return () => { sosWanted.current = false; sosGeneration.current++; if (!currentSession.current || !sharingStatuses.has(currentSession.current.status)) { cancelReason.current = 'cancel'; if (pendingNearby.current) void interruptNearby(pendingNearby.current).catch(() => {}); } }; }, [focused, token, userId]);
  const { accessibility } = useProfile();
  const { preferences } = usePreferences();
  const { soundFree, voiceHome, listen } = useAccess();
  const params = useLocalSearchParams<{ requestId?: string; help?: string; consented?: string }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (state.session?.status !== 'WAITING') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [state.session?.status]);
  const [consent, setConsent] = useState(false);
  const [chat, setChat] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [beaconBusy, setBeaconBusy] = useState(false);
  const beaconPending = useRef(false);
  const [requestedBeacon, setRequestedBeacon] = useState<{ requestId: string; beaconId: number; attemptId: string } | null>(null);
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
  const beacons = useBeacons({ accountId: userId, token, role: localSos || requester ? 1 : 2, active: focused && !active && (localSos || Boolean(requester && session?.nearby && session.status === 'WAITING') || autoSearch), optedIn: state.availability?.optedIn ?? false, contacts: state.contacts, incomingContacts: state.incomingContacts, contactsReady: state.contactsReady === true && !state.error, refresh: state.refresh });
  useEffect(() => { if (session && (sharingStatuses.has(session.status) || terminalStatuses.has(session.status))) cancelNearby('session'); }, [session?.status]);
  const currentSession = useRef(session);
  currentSession.current = session;
  const native = useBuddyNative({ token, sessionId: session?.id ?? null, active, manageBackground, language: language.startsWith('id') ? 'id' : 'en', onRefresh: id => { void state.refresh(id); } });
  const partner = requester ? session?.helperName : session?.requesterName;
  const partnerLocation = state.locations.find(item => item.userId !== userId);
  const fallbackName = session?.helperName ?? state.contacts.find(item => item.buddyUserId === session?.attempts[session.attempts.length - 1]?.helperUserId)?.name;
  const firstName = (partner ?? c('name')).split(' ')[0];
  // The end of a session is spoken per role: the person who was helped hears what to do next, not a status about themselves.
  const sessionStatus = requester && session?.status === 'FALLBACK_REQUIRED' ? fallbackName ? c('fallbackSearching', { name: fallbackName }) : c('fallbackSearchingNoName')
    : requester && session?.status === 'ARRIVED' && !session.meetingConfirmed ? c('helperArrivedSpoken', { name: firstName })
    : session?.status === 'COMPLETION_PENDING' ? requester ? c('arrivedSpoken', { name: firstName }) : c('waitingSafe', { name: firstName })
    : session?.status === 'COMPLETED' ? requester ? c('safeTitleSelf') : c('safeTitleOther', { name: firstName })
    : session ? status(session.status) : c('empty');
  const statusText = [sessionStatus, partner, partnerLocation ? `${c('updated')}: ${new Date(partnerLocation.observedAt).toLocaleTimeString(language)}. ${partnerLocation.stale ? c('stale') : native.location ? `${Math.round(distanceM(native.location, partnerLocation))} m` : ''}` : session && active ? c('locationMissing') : ''].filter(Boolean).join('. ');
  const confirm = (label: string, action: () => void, body = label, yes = c('yes')) => Alert.alert(label, body, [{ text: c('cancel'), style: 'cancel' }, { text: yes, onPress: action }]);
  const catchNative = (action: () => Promise<unknown>) => { setLocalError(null); void action().catch(cause => setLocalError(cause instanceof Error ? cause.message : c('requestFailed'))); };
  const openBeaconRequest = async (beaconId: number) => {
    if (beaconPending.current) return null;
    setLocalError(null);
    if (requester || localSos || active) { setLocalError(c('bluetoothRequestUnavailable')); return null; }
    if (!state.availability?.optedIn) { setLocalError(c('bluetoothOptInToAct')); return null; }
    beaconPending.current = true; setBeaconBusy(true);
    try {
      const network = await NetInfo.fetch();
      if (network.isConnected !== true || network.isInternetReachable === false) { setLocalError(c('bluetoothConnectToAct')); return null; }
      const offers = await buddyRequest<Session[]>(token, '/nearby/beacons', 'POST', { beaconIds: [beaconId] });
      if (!offers.length) { setLocalError(c('bluetoothRequestUnavailable')); return null; }
      return offers[0].id;
    } catch (cause) { setLocalError(c((cause as ApiError).kind === 'network' ? 'bluetoothConnectToAct' : 'bluetoothRequestUnavailable')); return null; }
    finally { beaconPending.current = false; setBeaconBusy(false); }
  };
  const askBeaconHelper = (beaconId: number) => {
    setLocalError(null);
    if (!requester || !session?.nearby || session.status !== 'WAITING' || active) { setLocalError(c(localSos ? 'bluetoothConnectToAct' : 'bluetoothStartRequest')); return; }
    const requestId = session.id;
    confirm(c('bluetoothAskHelperTitle'), () => {
      if (beaconPending.current) return;
      beaconPending.current = true; setBeaconBusy(true);
      void (async () => {
        const network = await NetInfo.fetch();
        if (network.isConnected !== true || network.isInternetReachable === false) { setLocalError(c('bluetoothConnectToAct')); return; }
        const selected = await state.run<Session & { selectedAttemptId: string }>(`/requests/${requestId}/nearby/helper`, { beaconId });
        if (selected) setRequestedBeacon({ requestId, beaconId, attemptId: selected.selectedAttemptId });
      })().catch(() => setLocalError(c('bluetoothRequestUnavailable'))).finally(() => { beaconPending.current = false; setBeaconBusy(false); });
    }, c('bluetoothAskHelperBody'), c('request'));
  };
  const autoShared = useRef<string | null>(null);
  const sessionId = session?.id;
  const shareOnAccept = useEffectEvent(() => { if (!native.tracking) catchNative(native.enableLocation); });
  // The helper's position is read once on this phone so the session map can show; it is shared only when they start travelling.
  const locateOnAccept = useEffectEvent(() => { if (!native.location) catchNative(native.obtainLocation); });
  useEffect(() => {
    if (!active || !sessionId || autoShared.current === sessionId) return;
    autoShared.current = sessionId;
    if (requester) shareOnAccept(); else locateOnAccept();
  }, [requester, active, sessionId]);
  const [approach, setApproach] = useState<{ sessionId: string; value: BuddyRoute } | null>(null);
  const approaching = Boolean(requester && active && (session?.status === 'ACCEPTED' || session?.status === 'EN_ROUTE'));
  useEffect(() => {
    if (!approaching || !sessionId) return;
    let cancelled = false;
    const load = () => buddyRequest<BuddyRoute>(token, `/requests/${sessionId}/route`, 'POST', { leg: 'TO_REQUESTER', profile: 'WALKING' })
      .then(result => { if (!cancelled && result.routeStatus === 'READY') setApproach({ sessionId, value: result }); })
      .catch(() => {});
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [approaching, sessionId, token]);
  const helperRoute = approaching && approach && approach.sessionId === sessionId ? approach.value : null;
  const transition = async (action: string, body: unknown = {}) => {
    if (action === 'interrupt') cancelNearby();
    if (!session) return false;
    const result = await state.run<Session>(`/requests/${session.id}/${action}`, body);
    if (!result) return false;
    if (action === 'accept') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (action === 'decline') state.dismissSession(); else await state.refresh(result.id);
    return true;
  };
  // One path for "help me" from the page, voice and Home: name the Buddy and the location sharing, then ask them.
  // Without a Buddy it says so and offers 112; it never dials on its own.
  const askForHelp = (targetId?: string) => {
    const contact = targetId ? state.contacts.find(item => item.buddyUserId === targetId) : state.contacts.find(item => item.level === 'PRIMARY') ?? state.contacts[0];
    const name = contact?.name ?? c('name');
    if (contact) { idempotency.current = null; confirm(c('askBuddyTitle', { name }), () => { void sendRequest(contact.buddyUserId); }, c('acceptBody', { name }), c('request')); }
    else Alert.alert(c('emptyTitle'), c('noBuddyHelp'), [{ text: c('cancel'), style: 'cancel' }, { text: c('call112'), onPress: () => { void Linking.openURL('tel:112'); } }]);
  };
  const first = state.contacts.find(item => item.level === 'PRIMARY') ?? state.contacts[0];
  const voiceStatusText = localSos ? [c(beacons.advertising ? 'bluetoothBroadcasting' : 'bluetoothSosUnavailable'), c('bluetoothOfflineSos'), c('bluetoothHelperCount', { count: String(beacons.people.filter(person => person.role === 2).length) })].join('. ') : session ? statusText : first ? c('voiceBuddyIdleBuddy', { name: first.name ?? c('name') }) : c('voiceBuddyIdleNone');
  const pendingConfirmation = useRef<{ action: () => Promise<unknown>; cancelled: boolean } | null>(null);
  const voice = useBuddySpeech({ stopSpeechOnUnmount: !voiceHome, language: language.startsWith('id') ? 'id' : 'en', onCommand: transcript => {
    if (voiceHome) {
      if (!prompt.focused || !listen || soundFree) return;
      voice.cancelListening();
      const pending = pendingConfirmation.current;
      if (pending) {
        pendingConfirmation.current = null;
        if (confirmCommand(transcript) === 'yes') {
          void pending.action().then(done => { if (pending.cancelled && done) void prompt.say(c('voiceBuddyCancelled')); }).catch(() => setLocalError(c('requestFailed')));
        } else void prompt.say(c('voiceBuddyKept'));
        return;
      }
    }
    const command = transcript.toLocaleLowerCase();
    if (/status|posisi/.test(command)) void (voiceHome ? prompt.say(voiceStatusText) : voice.speak(statusText));
    else if (/ulang|repeat/.test(command)) void (voiceHome ? prompt.say(route ? currentInstruction.current || c('noRoute') : c('noRoute')) : voice.speak(route ? currentInstruction.current || c('noRoute') : c('noRoute')));
    else if (/batal|akhiri|cancel|end/.test(command) && localSos) voiceHome ? askSpoken(c('voiceBuddyCancelAsk'), async () => { cancelNearby(); return true; }, true) : confirm(c('bluetoothCancel'), () => cancelNearby())
    else if (/batal|akhiri|cancel|end/.test(command) && session) voiceHome ? askSpoken(c('voiceBuddyCancelAsk'), () => transition('interrupt'), true) : confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'));
    else if (voiceHome && /\b(met|bertemu|here)\b|arrived with me/.test(command) && requester && session?.status === 'ARRIVED' && !session.meetingConfirmed) askSpoken(c('voiceBuddyMeetAsk'), () => transition('confirm-meeting'));
    else if (/selesai|complete|aman|safe/.test(command) && session?.status === 'COMPLETION_PENDING' && requester) voiceHome ? askSpoken(c('voiceBuddyCompleteAsk'), () => transition('confirm-complete')) : confirm(c('confirmSafe'), () => { void transition('confirm-complete'); }, c('confirmSafeBody'));
    else if (/terdekat|nearby/.test(command)) {
      if (voiceHome && session && terminalStatuses.has(session.status)) state.dismissSession();
      voiceHome ? askSpoken(c('voiceBuddyNearbyAsk'), () => startNearby(true)) : askNearby();
    }
    else if ((/bantuan|help/.test(command) || (voiceHome && /tolong/.test(command))) && (!session || (voiceHome && terminalStatuses.has(session.status)))) {
      if (session) state.dismissSession();
      voiceHome ? first ? askSpoken(c('voiceBuddyHelpAsk', { name: first.name ?? c('name') }), () => sendRequest(first.buddyUserId)) : void prompt.say(c('noBuddyHelp')) : askForHelp();
    }
    else void (voiceHome ? prompt.say(c('unknownCommand')) : voice.speak(c('unknownCommand')));
  } });
  const prompt = useVoicePrompt(voice, voiceHome && listen && !soundFree, language);
  const askSpoken = (text: string, action: () => Promise<unknown>, cancelled = false) => {
    pendingConfirmation.current = { action, cancelled };
    void prompt.say(text, () => { void prompt.listen(); });
  };
  useEffect(() => { if (!prompt.focused || !listen || soundFree) pendingConfirmation.current = null; }, [prompt.focused, listen, soundFree]);
  const voiceStatusKey = localSos ? `local-sos:${beacons.status}:${beacons.advertising}:${beacons.people.filter(person => person.role === 2).length}:${sosSending}` : session ? `${session.id}:${session.status}` : JSON.stringify([first?.buddyUserId, first?.name]);
  // When the requester's next step is to speak ("we met", "I'm safe"), the phone listens right after telling them, with no button to find first.
  const readVoiceStatus = useEffectEvent(() => { if (!pendingConfirmation.current && !voice.listening) void prompt.say(voiceStatusText, requester && (session?.status === 'COMPLETION_PENDING' || (session?.status === 'ARRIVED' && !session.meetingConfirmed)) ? () => { void prompt.listen(); } : undefined); });
  useEffect(() => { if (voiceHome && listen && !soundFree && prompt.focused) readVoiceStatus(); }, [voiceHome, listen, soundFree, prompt.focused, voiceStatusKey]);
  const toggleVoice = () => {
    if (!listen || soundFree || !prompt.focused) return;
    if (voice.listening) voice.stopListening();
    else { prompt.cancel(); void prompt.listen(); }
  };
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!session || lastStatus.current === `${session.id}:${session.status}`) return;
    lastStatus.current = `${session.id}:${session.status}`;
    // Arrival is felt as well as heard: it is the one moment the person who was helped has to act.
    if (requester && session.status === 'COMPLETION_PENDING' && preferences.vibrationEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (voiceHome) return;
    if (preferences.voiceEnabled && !soundFree) void voice.speak(sessionStatus);
    else AccessibilityInfo.announceForAccessibility(sessionStatus);
  }, [session, requester, preferences.voiceEnabled, preferences.vibrationEnabled, soundFree, sessionStatus, voice, voiceHome]);
  const refreshState = state.refresh;
  useEffect(() => { if (params.requestId) void refreshState(params.requestId); }, [params.requestId, refreshState]);
  // Home's "Ask for help" arrives as ?help=<timestamp>; each new value asks once, after the Buddy list has loaded.
  const askedFor = useRef<string | null>(null);
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
      try { const network = await NetInfo.fetch(); if (cancelled || network.isConnected !== true || network.isInternetReachable === false) return; const position = await availabilityPosition(); if (!cancelled) await buddyRequest(token, '/availability', 'PUT', { optedIn: true, refreshOnly: true, ...position }); }
      catch (cause) { if (!cancelled) availabilityFailure(cause); }
      finally { pending = false; }
    };
    void refresh();
    const reconnect = NetInfo.addEventListener(network => { if (network.isConnected === true && network.isInternetReachable !== false) void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { cancelled = true; clearInterval(timer); reconnect(); };
  }, [state.availability?.optedIn, token]);

  const sendRequest = async (target: string) => {
    idempotency.current ??= `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await state.run<Session>('/requests', { helperUserId: target, message: '', supportNeeds: accessibility.map(item => item.type), sharingConsent: true, idempotencyKey: idempotency.current });
    if (result) { idempotency.current = null; await state.refresh(result.id); }
  };
  const askNearby = () => confirm(c('searchNearbyTitle'), () => { void startNearby(true); }, c('searchNearbyBody'), c('searchShort'));
  const nearbyPending = useRef(false);
  const fallbackSearched = useRef(new Set<string>());
  const startNearby = async (voiceConfirmed = false, offer112 = false) => {
    if (nearbyPending.current) return false;
    const generation = sosGeneration.current;
    cancelReason.current = 'cancel';
    if (!consent && !voiceConfirmed) { setLocalError(c('consentRequired')); return false; }
    nearbyPending.current = true; setSosSending(true);
    try {
      const network = await NetInfo.fetch();
      if (generation !== sosGeneration.current || !focused || AppState.currentState !== 'active') return false;
      if (network.isConnected !== true || network.isInternetReachable === false) {
        sosWanted.current = true; setLocalSos(true); setLocalError(null); return true;
      }
      const queued = sosWanted.current;
      let position: Position;
      try { position = await native.obtainLocation(); }
      catch (cause) {
        if (offer112) Alert.alert(c('locationMissing'), readableIssue(cause instanceof Error ? cause.message : c('locationMissing'), c) ?? c('locationMissing'), [{ text: c('cancel'), style: 'cancel' }, { text: c('call112'), onPress: () => { void Linking.openURL('tel:112'); } }]);
        throw cause;
      }
      if (generation !== sosGeneration.current || !focused || AppState.currentState !== 'active') return false;
      const latestSession = currentSession.current;
      if (latestSession && sharingStatuses.has(latestSession.status)) return false;
      if (latestSession && !terminalStatuses.has(latestSession.status) && !pendingNearby.current) {
        const done = Boolean(await state.run(`/requests/${latestSession.id}/nearby`, position));
        if (done) { sosWanted.current = false; setLocalSos(false); }
        return done;
      }
      idempotency.current ??= `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const created = pendingNearby.current ? { id: pendingNearby.current } : await state.run<Session>('/requests', { helperUserId: null, message: '', supportNeeds: accessibility.map(item => item.type), sharingConsent: true, idempotencyKey: idempotency.current, ...position });
      if (created) {
        if (generation !== sosGeneration.current || !focused || AppState.currentState !== 'active') { if (!cancelledBySession()) await interruptNearby(created.id); return false; }
        pendingNearby.current = created.id;
        const nearby = await state.run<Session>(`/requests/${created.id}/nearby`, position);
        if (generation !== sosGeneration.current) { if (!cancelledBySession()) await interruptNearby(created.id); return false; }
        if (!nearby) { sosWanted.current = true; setLocalSos(true); return false; }
        await state.refresh(created.id);
        if (generation !== sosGeneration.current) return false;
        sosWanted.current = false; pendingNearby.current = null; idempotency.current = null; setLocalSos(false);
      } else if (queued && generation === sosGeneration.current) { sosWanted.current = true; setLocalSos(true); }
      return Boolean(created);
    } catch (cause) { if (generation === sosGeneration.current) setLocalError(cause instanceof Error ? cause.message : c('locationMissing')); return false; }
    finally { nearbyPending.current = false; setSosSending(false); }
  };
  const resumeNearby = useEffectEvent(() => { if (sosWanted.current && focused && AppState.currentState === 'active') void startNearby(true); });
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(network => { if (network.isConnected === true && network.isInternetReachable !== false) resumeNearby(); });
    const app = AppState.addEventListener('change', next => { if (next === 'active') resumeNearby(); else if (nearbyPending.current) sosGeneration.current++; });
    return () => { unsubscribe(); app.remove(); };
  }, [token, userId]);
  const askFromHome = useEffectEvent(() => {
    if (params.consented !== '1') { askForHelp(); return; }
    const contact = state.contacts.find(item => item.level === 'PRIMARY') ?? state.contacts[0];
    idempotency.current = null;
    if (contact) void sendRequest(contact.buddyUserId); else void startNearby(true, true);
  });
  useEffect(() => {
    if (!params.help || askedFor.current === params.help || state.loading || state.error || (session && !terminalStatuses.has(session.status))) return;
    askedFor.current = params.help;
    if (session) state.dismissSession();
    askFromHome();
  }, [params.help, params.consented, state.loading, state.error, session, state.dismissSession]);
  // A failed search (no location, request error) is not recorded, so the next refresh or Retry tries again.
  const searchFallback = useEffectEvent((id: string) => { void startNearby(true).then(done => { if (done) fallbackSearched.current.add(id); }); });
  useEffect(() => {
    if (!requester || session?.status !== 'FALLBACK_REQUIRED' || fallbackSearched.current.has(session.id) || nearbyPending.current) return;
    searchFallback(session.id);
  }, [requester, session]);
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
  // Turn-by-turn is a state of the session map, on for the helper's two walking legs and only where the map can follow them.
  const [navigatingFor, setNavigatingFor] = useState<string | null>(null);
  const walkingLeg = requester || !session ? null : session.status === 'EN_ROUTE' ? 'TO_REQUESTER' as const : session.status === 'EVACUATING' ? 'TO_SHELTER' as const : null;
  const navigating = Boolean(usesMapbox() && active && session && navigatingFor === session.id && walkingLeg && route?.route && route.leg === walkingLeg);
  const startNavigation = async (leg: 'TO_REQUESTER' | 'TO_SHELTER') => {
    if (!session) return;
    setNavigatingFor(session.id);
    if (!route?.route || route.leg !== leg) await requestRoute(leg);
  };
  const stopNavigation = () => setNavigatingFor(null);
  const sendMessage = async (text: string) => {
    if (!session || !text.trim()) return;
    if (chatKey.current?.text !== text.trim()) chatKey.current = { text: text.trim(), key: `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}` };
    if (await state.run(`/requests/${session.id}/messages`, { text: text.trim(), idempotencyKey: chatKey.current.key })) { setChat(''); chatKey.current = null; }
  };
  const attempt = session?.attempts.find(item => item.helperUserId === userId && item.status === 'PENDING' && Date.parse(item.expiresAt) > now && session?.status === 'WAITING');
  const requestedBeaconId = requestedBeacon?.requestId === session?.id && session?.status === 'WAITING' && session.attempts.some(item => item.id === requestedBeacon?.attemptId && item.status === 'PENDING' && Date.parse(item.expiresAt) > now) ? requestedBeacon?.beaconId : null;
  const issue = readableIssue(state.error ?? localError ?? native.error ?? voice.error, c);
  const guidance = useRouteGuidance({ entranceNote: route?.destination?.entranceNote, destinationName: route?.destination?.name, route: active ? route ?? null : null, position: native.location, target: requesterPoint, language: language.startsWith('id') ? 'id' : 'en', reroute: () => { if (route) void requestRoute(route.leg); }, speak: voiceHome ? prompt.say : voice.speak, voiceEnabled: voiceHome ? listen && !soundFree && prompt.focused : preferences.voiceEnabled && !soundFree, haptics: preferences.vibrationEnabled, cue: text => c('inMeters', { m: String(CUE_M), text: text.charAt(0).toLocaleLowerCase() + text.slice(1) }), onInstruction: text => { currentInstruction.current = text ?? c('stale'); } });

  return { beacons, beaconBusy, openBeaconRequest, askBeaconHelper, requestedBeaconId, localSos, sosSending, cancelNearby, state, c, status, language, support, event, accessibility, preferences, helperRoute, consent, setConsent, chat, setChat, setLocalError, shelters, setShelters, selectedShelter, setSelectedShelter, wheelchair, setWheelchair, routeBusy, guidance, navigating, startNavigation, stopNavigation, session, active, route, requesterPoint, requester, native, partner, sessionStatus, statusText, voiceStatusText, toggleVoice, readVoiceStatus: () => { void prompt.say(voiceStatusText); }, voice, attempt, issue, confirm, catchNative, transition, askForHelp, askNearby, startNearby, requestRoute, sendMessage };
}

export type BuddyActions = ReturnType<typeof useBuddyActions>;
