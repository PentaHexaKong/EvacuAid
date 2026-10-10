import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { speak as speakAloud } from '../feedback/speech';
import type { ApiError } from '../profile/api';
import { authSession } from '../profile/auth-session';
import { buddyRequest } from './api';
import { ensureBackground, ensureForeground, ensureNotifications } from '@/features/location/permissions';
import { prepareNotificationChannel, registerPushToken } from '@/features/location/push-token';

const TASK = 'evacuaid.buddy-location.v1';
const SESSION_KEY = 'evacuaid.buddy-location-session.v1';
type SavedSession = { userId: string; sessionId: string };
// No distance filter: iOS only reports movement past it, so someone standing still would look like they lost GPS. Uploads stay at one per 5 s.
const WATCH = { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 };
const UPLOAD_GAP_MS = 5000;

export type BuddyPosition = { latitude: number; longitude: number; accuracyM: number; observedAt: string };
const position = (value: Location.LocationObject): BuddyPosition => ({ latitude: value.coords.latitude, longitude: value.coords.longitude, accuracyM: value.coords.accuracy ?? 10000, observedAt: new Date(value.timestamp).toISOString() });
const path = (id: string) => `/requests/${id}/location`;

async function stopBackground() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
}

if (!TaskManager.isTaskDefined(TASK)) TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations.length) return;
  const saved = await SecureStore.getItemAsync(SESSION_KEY);
  if (!saved) return;
  const session = JSON.parse(saved) as SavedSession;
  try {
    const account = await authSession.restore();
    if (!account || account.user.id !== session.userId) { await stopBackground(); return; }
    const token = await authSession.current(account.access_token);
    await buddyRequest(token, path(session.sessionId), 'PUT', position(data.locations[data.locations.length - 1]));
  } catch (cause) {
    if ([401, 403, 404, 409, 410].includes((cause as ApiError).status ?? 0)) await stopBackground();
  }
});

export function useBuddyNative({ sessionId, active, token, onRefresh, language = 'en', manageBackground = true }: { sessionId: string | null; active: boolean | undefined; token: string | null; language?: 'id' | 'en'; manageBackground?: boolean; onRefresh: (requestId?: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [settingsBlocked, setSettingsBlocked] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [foregroundOnly, setForegroundOnly] = useState(false);
  const [location, setLocation] = useState<BuddyPosition | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const sentAt = useRef(0);
  const generation = useRef(0);
  const starting = useRef(false);
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);
  const message = (en: string, id: string) => language === 'id' ? id : en;
  const fail = (cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Native service unavailable.'); };

  const obtainLocation = async () => {
    setError(null);
    const permission = await ensureForeground();
    setSettingsBlocked(permission === 'blocked');
    if (permission !== 'granted') throw new Error(message('Location permission is required. You can enable it in Settings.', 'Izin lokasi diperlukan. Aktifkan di Pengaturan.'));
    const value = position(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    setLocation(value);
    return value;
  };
  const stopLocation = async () => {
    generation.current += 1;
    watch.current?.remove();
    watch.current = null;
    setTracking(false);
    if (manageBackground) await stopBackground();
    if (token && sessionId && active) await buddyRequest(token, path(sessionId), 'DELETE');
  };
  const enableLocation = async () => {
    if (!active || !token || !sessionId) throw new Error(message('Accept a Buddy session before sharing location.', 'Terima sesi Buddy sebelum berbagi lokasi.'));
    if (starting.current) return;
    starting.current = true;
    const run = ++generation.current;
    const ensureCurrent = () => { if (generation.current !== run) throw new Error(message('Location sharing was stopped.', 'Berbagi lokasi dihentikan.')); };
    setError(null);
    try {
      const current = await obtainLocation();
      ensureCurrent();
      const { sharingVersion } = await buddyRequest<{ sharingVersion: number }>(token, path(sessionId));
      ensureCurrent();
      await buddyRequest(token, path(sessionId), 'PUT', { ...current, sharingConsent: true, sharingVersion });
      if (generation.current !== run) { await buddyRequest(token, path(sessionId), 'DELETE'); ensureCurrent(); }
      watch.current?.remove();
      watch.current = await Location.watchPositionAsync(WATCH, value => {
        if (generation.current !== run) return;
        const next = position(value);
        setLocation(next);
        if (Date.now() - sentAt.current < UPLOAD_GAP_MS) return;
        sentAt.current = Date.now();
        void buddyRequest(token, path(sessionId), 'PUT', next).catch(cause => {
          fail(cause);
          if ([401, 403, 404, 409, 410].includes((cause as ApiError).status ?? 0)) {
            watch.current?.remove(); watch.current = null; setTracking(false); if (manageBackground) void stopBackground().catch(fail);
          }
        });
      });
      if (generation.current !== run) { watch.current?.remove(); watch.current = null; ensureCurrent(); }
      setTracking(true);
      if (!manageBackground) return;
      const account = authSession.get();
      if (!account) throw new Error('Sign in before enabling background location.');
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ userId: account.user.id, sessionId }), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
      if (generation.current !== run) { await stopBackground(); ensureCurrent(); }
      const permission = await ensureBackground();
      ensureCurrent();
      setForegroundOnly(permission !== 'granted');
      setSettingsBlocked(permission === 'blocked');
      if (permission === 'blocked') setError(message('Location permission is required. You can enable it in Settings.', 'Izin lokasi diperlukan. Aktifkan di Pengaturan.'));
      if (permission !== 'granted') return;
      await Location.startLocationUpdatesAsync(TASK, { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 5, deferredUpdatesInterval: 15000, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, foregroundService: { notificationTitle: 'EvacuAid Buddy', notificationBody: message('Sharing location during your accepted Buddy session.', 'Berbagi lokasi selama sesi Buddy yang diterima.') } });
      if (generation.current !== run) { await stopBackground(); ensureCurrent(); }
    } catch (cause) { fail(cause); throw cause; } finally { starting.current = false; }
  };
  const enableNotifications = async () => {
    setError(null);
    try {
      if (!token) throw new Error(message('Sign in first.', 'Masuk terlebih dahulu.'));
      await prepareNotificationChannel();
      const permission = await ensureNotifications();
      setSettingsBlocked(permission === 'blocked');
      if (permission !== 'granted') throw new Error(message('Notifications are disabled. Requests remain available in the app.', 'Notifikasi dinonaktifkan. Permintaan tetap tersedia di aplikasi.'));
      try { await registerPushToken(token); }
      catch (cause) {
        if (cause instanceof Error && cause.message === 'Push is not configured in this build. In-app updates remain available.') throw new Error(message(cause.message, 'Notifikasi push belum dikonfigurasi pada versi ini. Pembaruan dalam aplikasi tetap tersedia.'));
        throw cause;
      }
    } catch (cause) { fail(cause); throw cause; }
  };
  useEffect(() => {
    const receive = (data: Record<string, unknown> = {}) => refresh.current(typeof data.requestId === 'string' ? data.requestId : undefined);
    const received = Notifications.addNotificationReceivedListener(value => receive(value.request.content.data));
    const response = Notifications.addNotificationResponseReceivedListener(value => receive(value.notification.request.content.data));
    void Notifications.getLastNotificationResponseAsync().then(value => { if (value) receive(value.notification.request.content.data); }).catch(fail);
    return () => { received.remove(); response.remove(); };
  }, []);
  useEffect(() => {
    if (!manageBackground || active === undefined) return;
    let cancelled = false;
    const restoreGeneration = ++generation.current;
    if (!active || !sessionId || !token) { watch.current?.remove(); watch.current = null; void stopBackground().then(() => setTracking(false)).catch(fail); }
    else void SecureStore.getItemAsync(SESSION_KEY).then(async saved => {
      if (!saved || cancelled || generation.current !== restoreGeneration) return;
      const prior = JSON.parse(saved) as SavedSession;
      if (prior.sessionId !== sessionId || prior.userId !== authSession.get()?.user.id) { await stopBackground(); return; }
      const permission = await Location.getForegroundPermissionsAsync();
      if (cancelled || generation.current !== restoreGeneration) return;
      if (!permission.granted) { await stopBackground(); return; }
      const subscription = await Location.watchPositionAsync(WATCH, value => {
        if (generation.current !== restoreGeneration) return;
        const next = position(value); setLocation(next);
        if (Date.now() - sentAt.current < UPLOAD_GAP_MS) return;
        sentAt.current = Date.now();
        void buddyRequest(token, path(sessionId), 'PUT', next).catch(cause => {
          fail(cause);
          if ([401, 403, 404, 409, 410].includes((cause as ApiError).status ?? 0)) { watch.current?.remove(); watch.current = null; setTracking(false); void stopBackground().catch(fail); }
        });
      });
      if (cancelled || generation.current !== restoreGeneration) { subscription.remove(); return; }
      watch.current = subscription; setTracking(true);
    }).catch(fail);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh.current(); });
    return () => { generation.current += 1; cancelled = true; listener.remove(); watch.current?.remove(); watch.current = null; };
  }, [active, sessionId, token, manageBackground]);
  useEffect(() => {
    if (!tracking || !active || !sessionId || !token) return;
    const timer = setInterval(() => {
      void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(value => {
        const next = position(value); setLocation(next);
        return buddyRequest(token, path(sessionId), 'PUT', next);
      }).catch(fail);
    }, 10000);
    return () => clearInterval(timer);
  }, [tracking, active, sessionId, token]);
  return { ...(settingsBlocked ? { settingsBlocked: true } : {}), error, tracking, foregroundOnly, location, obtainLocation, enableLocation, stopLocation, enableNotifications };
}

export function useBuddySpeech({ language, onCommand, stopSpeechOnUnmount = true }: { language: 'id' | 'en'; onCommand: (transcript: string) => void; stopSpeechOnUnmount?: boolean }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recognition events reach every mounted listener; Home and Buddy each act only on the speech they started.
  const mine = useRef(false);
  useSpeechRecognitionEvent('start', () => { if (mine.current) setListening(true); });
  useSpeechRecognitionEvent('end', () => { if (!mine.current) return; mine.current = false; setListening(false); });
  useSpeechRecognitionEvent('error', event => {
    if (!mine.current) return;
    mine.current = false;
    setListening(false);
    if (event.error === 'aborted') return;
    setError(language === 'id' ? 'Pengenalan suara berhenti. Kontrol sentuh tetap tersedia.' : 'Speech recognition stopped. Touch controls are still available.');
  });
  useSpeechRecognitionEvent('result', event => { if (mine.current && event.isFinal && event.results[0]?.transcript) onCommand(event.results[0].transcript); });
  const startListening = async () => {
    setError(null);
    try {
      await Speech.stop();
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error(language === 'id' ? 'Izin mikrofon dan pengenalan suara diperlukan. Kontrol sentuh tetap tersedia.' : 'Microphone and speech permission are required. Touch controls remain available.');
      mine.current = true;
      ExpoSpeechRecognitionModule.start({ lang: language === 'id' ? 'id-ID' : 'en-US', interimResults: false, continuous: false });
    } catch (cause) { mine.current = false; setError(cause instanceof Error ? cause.message : 'Speech recognition unavailable.'); }
  };
  const cancelListening = useCallback(() => { if (!mine.current) return; mine.current = false; setListening(false); ExpoSpeechRecognitionModule.abort(); }, []);
  const speak = (text: string) => speakAloud(text, language);
  useEffect(() => () => { if (mine.current) ExpoSpeechRecognitionModule.abort(); if (stopSpeechOnUnmount) void Speech.stop(); }, [stopSpeechOnUnmount]);
  return { listening, error, startListening, stopListening: () => ExpoSpeechRecognitionModule.stop(), cancelListening, speak };
}

// Local notifications stand in for push on builds that can't receive it: they show while the app runs or is backgrounded.
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

const NOTIFY_KINDS = new Set(['OFFER', 'INVITATION_REDEEMED']);
type InboxEntry = { id: string; kind: string; read: boolean; requestId: string | null };

// One local notification per new unread incoming request or friend request; items present on first load are history, not news.
export function useInboxNotifications(inbox: InboxEntry[], title: (kind: string) => string) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(inbox.map(item => item.id)); return; }
    const fresh = inbox.filter(item => !seen.current!.has(item.id) && !item.read && NOTIFY_KINDS.has(item.kind));
    inbox.forEach(item => seen.current!.add(item.id));
    if (!fresh.length) return;
    void (async () => {
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      for (const item of fresh) await Notifications.scheduleNotificationAsync({ content: { title: title(item.kind), body: 'EvacuAid Buddy', data: item.requestId ? { requestId: item.requestId } : { inboxId: item.id } }, trigger: null });
    })().catch(() => {});
  }, [inbox, title]);
}
