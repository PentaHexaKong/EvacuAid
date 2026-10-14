import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buddyRequest, sharingStatuses, terminalStatuses, type Availability, type Contact, type InboxItem, type Invitation, type Message, type Session, type SharedPosition } from './api';

const offlineContact = (contact: Contact): Contact => ({ id: contact.id, userId: contact.userId, buddyUserId: contact.buddyUserId, name: contact.name, level: contact.level, status: contact.status, available: false, observedAt: null, beaconId: contact.beaconId });

const keep = <T,>(next: T) => (prev: T) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next;

export function useBuddy(token: string | null, accountId?: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [incomingContacts, setIncomingContacts] = useState<Contact[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [received, setReceived] = useState<Invitation[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [locations, setLocations] = useState<SharedPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contactsReady, setContactsReady] = useState(false);
  const selected = useRef<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentSession = useRef(session);
  const accountKey = accountId ? `evacuaid.buddy.offline.v1:${accountId}` : null;
  const onlineLoaded = useRef(false);
  const pendingOptOut = useRef(false);
  const cacheReady = useRef<Promise<unknown>>(Promise.resolve());
  const actionVersion = useRef(0);
  const scope = useRef({ token, accountKey });
  scope.current = { token, accountKey };
  useEffect(() => {
    onlineLoaded.current = false; pendingOptOut.current = false; actionVersion.current++; pending.current = false; setBusy(false); setContactsReady(false);
    setContacts([]); setIncomingContacts([]); setAvailability(null); setSession(null); setMessages([]); setLocations([]); setInbox([]); setInvitations([]); setReceived([]); setLoading(true);
    if (!accountKey) return;
    let alive = true;
    cacheReady.current = AsyncStorage.getItem(accountKey).then(value => {
      if (!alive || onlineLoaded.current || !value) return;
      const saved = JSON.parse(value);
      pendingOptOut.current = saved.pendingOptOut === true;
      setLoading(false);
      if (Array.isArray(saved.contacts)) setContacts(saved.contacts);
      if (Array.isArray(saved.incomingContacts)) setIncomingContacts(saved.incomingContacts);
      if (typeof saved.availability?.optedIn === 'boolean' && typeof saved.availability?.enrolled === 'boolean') setAvailability({ ...saved.availability, optedIn: pendingOptOut.current ? false : saved.availability.optedIn });
    }).catch(() => {});
    return () => { alive = false; };
  }, [accountKey, token]);
  useEffect(() => { currentSession.current = session; }, [session]);

  const refresh = useCallback(async (requestId?: string) => {
    if (!token) return;
    if (requestId) selected.current = requestId;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++generation.current;
    try {
      await cacheReady.current;
      if (version !== generation.current) return;
      if (pendingOptOut.current) {
        await buddyRequest(token, '/availability', 'PUT', { optedIn: false }, abort.signal);
        if (version !== generation.current) return;
        pendingOptOut.current = false;
      }
      const get = <T,>(path: string) => buddyRequest<T>(token, path, 'GET', undefined, abort.signal);
      const getSession = async () => {
        const current = await get<Session | null>('/requests/current');
        if (current) return current;
        return selected.current ? get<Session>(`/requests/${selected.current}`) : null;
      };
      const [nextContacts, nextInvitations, nextInbox, nextAvailability, nextSession, nextIncoming, nextReceived] = await Promise.all([
        get<Contact[]>('/contacts'), get<Invitation[]>('/invitations'), get<InboxItem[]>('/inbox'), get<Availability>('/availability'),
        getSession(),
        get<Contact[]>('/contacts/incoming'), get<Invitation[]>('/invitations/received'),
      ]);
      let nextMessages: Message[] = [];
      let nextLocations: SharedPosition[] = [];
      if (nextSession && sharingStatuses.has(nextSession.status)) {
        const [chat, positions] = await Promise.all([get<Message[]>(`/requests/${nextSession.id}/messages`), get<{ locations: SharedPosition[] }>(`/requests/${nextSession.id}/location`)]);
        nextMessages = chat; nextLocations = positions.locations;
      }
      if (version !== generation.current) return;
      onlineLoaded.current = true; setContactsReady(true);
      const effectiveAvailability = pendingOptOut.current ? { ...nextAvailability, optedIn: false } : nextAvailability;
      if (accountKey) void AsyncStorage.setItem(accountKey, JSON.stringify({ contacts: nextContacts.map(offlineContact), incomingContacts: nextIncoming.map(offlineContact), availability: effectiveAvailability, pendingOptOut: pendingOptOut.current })).catch(() => {});
      setContacts(keep(nextContacts)); setIncomingContacts(keep(nextIncoming)); setInvitations(keep(nextInvitations)); setReceived(keep(nextReceived)); setInbox(keep(nextInbox)); setAvailability(keep<Availability | null>(effectiveAvailability));
      setSession(keep(nextSession)); setMessages(keep(nextMessages)); setLocations(keep(nextLocations)); setError(null);
    } catch (cause) {
      if (version !== generation.current || (cause as Error).name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Connection unavailable');
      setLocations([]);
      if ([403, 404].includes((cause as Error & { status?: number }).status ?? 0)) { selected.current = null; setSession(null); setMessages([]); }
    } finally { if (version === generation.current) setLoading(false); }
  }, [token, accountKey]);

  const cancelRefresh = useCallback(() => { generation.current++; controller.current?.abort(); }, []);

  useEffect(() => {
    selected.current = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let running = false;
    const poll = async () => {
      if (stopped || running || AppState.currentState !== 'active') return;
      running = true;
      try { await refresh(); } finally { running = false; }
      if (!stopped && AppState.currentState === 'active') timer = setTimeout(poll, currentSession.current && !terminalStatuses.has(currentSession.current.status) ? 2000 : 4000);
    };
    void poll();
    const subscription = AppState.addEventListener('change', state => {
      clearTimeout(timer);
      if (state === 'active') void poll();
      else cancelRefresh();
    });
    return () => { stopped = true; clearTimeout(timer); subscription.remove(); cancelRefresh(); };
  }, [refresh, cancelRefresh]);

  const run = async <T,>(path: string, body?: unknown, method = 'POST'): Promise<T | undefined> => {
    if (!token || pending.current) return;
    const version = ++actionVersion.current;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await buddyRequest<T>(token, path, method, body);
      if (scope.current.token !== token || scope.current.accountKey !== accountKey) return result;
      await refresh();
      return result;
    } catch (cause) { if (version === actionVersion.current) setError(cause instanceof Error ? cause.message : 'Request failed'); return undefined; }
    finally { if (version === actionVersion.current) { pending.current = false; setBusy(false); } }
  };

  const setOfflineAvailability = async (optedIn: boolean) => {
    if (optedIn) return;
    pendingOptOut.current = true;
    const next = { enrolled: availability?.enrolled ?? false, optedIn, observedAt: availability?.observedAt ?? null };
    setAvailability(next);
    if (accountKey) await AsyncStorage.setItem(accountKey, JSON.stringify({ contacts: contacts.map(offlineContact), incomingContacts: incomingContacts.map(offlineContact), availability: next, pendingOptOut: true }));
  };

  const dismissSession = () => { selected.current = null; setSession(null); void refresh(); };
  return { contacts, incomingContacts, invitations, received, inbox, availability, session, messages, locations, error, loading, busy, contactsReady, refresh, run, dismissSession, setOfflineAvailability };
}

export function useBuddyCode(token: string | null) {
  const [result, setResult] = useState<{ token: string; code: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void buddyRequest<{ code: string }>(token, '/me/code', 'GET', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setResult({ token, code: value.code }); }).catch(() => {});
    return () => controller.abort();
  }, [token]);
  return result?.token === token ? result?.code ?? null : null;
}
