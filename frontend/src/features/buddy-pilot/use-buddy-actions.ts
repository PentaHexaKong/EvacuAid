import { useAccess } from '@/features/access/use-access';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useProfile } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { buddyRequest, sharingStatuses, terminalStatuses, type BuddyRoute, type Invitation, type Position, type Session } from '@/features/buddy-pilot/api';
import type { useBuddyPilot } from '@/features/buddy-pilot/use-buddy-pilot';
import type { ApiError } from '@/features/profile/api';
import { useBuddyNative, useBuddySpeech } from '@/features/buddy-pilot/native';
import { readableIssue, useBuddyCopy } from '@/features/buddy-pilot/copy';
import type { Shelter } from '@/features/navigation/api';
import { distanceM } from '@/features/buddy-pilot/navigation';

export function useBuddyActions({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddyPilot> }) {
  const { c, status, language, support, event } = useBuddyCopy();
  const { accessibility } = useProfile();
  const { preferences } = usePreferences();
  const { soundFree } = useAccess();
  const params = useLocalSearchParams<{ code?: string; requestId?: string; help?: string }>();
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
  const autoShared = useRef<string | null>(null);
  const sessionId = session?.id;
  const shareOnAccept = useEffectEvent(() => { if (!native.tracking) catchNative(native.enableLocation); });
  useEffect(() => {
    if (!requester || !active || !sessionId || autoShared.current === sessionId) return;
    autoShared.current = sessionId;
    shareOnAccept();
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
    if (!session) return;
    const result = await state.run<Session>(`/requests/${session.id}/${action}`, body);
    if (result) { if (action === 'decline') state.dismissSession(); else await state.refresh(result.id); }
  };
  // One path for "help me" from voice and from Home: confirm out loud, then ask the chosen or primary Buddy.
  // Without a Buddy it says so and offers 112; it never dials on its own.
  const askForHelp = () => {
    const target = helper ?? state.contacts.find(item => item.level === 'PRIMARY')?.buddyUserId;
    if (target) confirm(c('send'), () => { void sendRequest(target, true); }, c('consent'));
    else Alert.alert(c('emptyTitle'), c('noBuddyHelp'), [{ text: c('cancel'), style: 'cancel' }, { text: c('call112'), onPress: () => { void Linking.openURL('tel:112'); } }]);
  };
  const voice = useBuddySpeech({ language: language.startsWith('id') ? 'id' : 'en', onCommand: transcript => {
    const command = transcript.toLocaleLowerCase();
    if (/status|posisi/.test(command)) void voice.speak(statusText);
    else if (/ulang|repeat/.test(command)) void voice.speak(route ? currentInstruction.current || c('noRoute') : c('noRoute'));
    else if (/batal|akhiri|cancel|end/.test(command) && session) confirm(c('interrupt'), () => { void transition('interrupt'); }, c('endBody'));
    else if (/selesai|complete/.test(command) && session?.status === 'COMPLETION_PENDING' && requester) confirm(c('confirmComplete'), () => { void transition('confirm-complete'); });
    else if (/terdekat|nearby/.test(command)) confirm(c('nearby'), () => { void startNearby(true); }, `${c('nearbyExplanation')} ${c('consent')}`);
    else if (/bantuan|help/.test(command) && !session) askForHelp();
    else void voice.speak(c('unknownCommand'));
  } });
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!session || lastStatus.current === `${session.id}:${session.status}`) return;
    lastStatus.current = `${session.id}:${session.status}`;
    if (preferences.voiceEnabled && !soundFree) void voice.speak(status(session.status));
    else AccessibilityInfo.announceForAccessibility(status(session.status));
  }, [session, preferences.voiceEnabled, soundFree, status, voice]);
  const refreshState = state.refresh;
  useEffect(() => { if (params.requestId) void refreshState(params.requestId); }, [params.requestId, refreshState]);
  // Home's "Ask for help" arrives as ?help=<timestamp>; each new value asks once, after the Buddy list has loaded.
  const askedFor = useRef<string | null>(null);
  const askFromHome = useEffectEvent(() => askForHelp());
  useEffect(() => {
    if (!params.help || askedFor.current === params.help || state.loading || session) return;
    askedFor.current = params.help;
    askFromHome();
  }, [params.help, state.loading, session]);
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
  const issue = readableIssue(state.error ?? localError ?? native.error ?? voice.error, c);
  const setCurrentInstruction = (instruction: string) => { currentInstruction.current = instruction; };
  const resetIdempotency = () => { idempotency.current = null; };

  return { state, c, status, language, support, event, accessibility, preferences, helperRoute, code, setCode, invite, setInvite, enrollment, setEnrollment, helper, setHelper, message, setMessage, consent, setConsent, chat, setChat, setLocalError, shelters, setShelters, selectedShelter, setSelectedShelter, wheelchair, setWheelchair, routeBusy, setCurrentInstruction, resetIdempotency, session, active, route, requesterPoint, requester, native, partner, statusText, voice, attempt, issue, confirm, catchNative, transition, sendRequest, startNearby, requestRoute, sendMessage };
}

export type BuddyActions = ReturnType<typeof useBuddyActions>;
