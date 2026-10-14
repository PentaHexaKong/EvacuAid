import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as BeaconModule from '../../../modules/buddy-beacon';
import { buddyRequest, type Contact, type Session } from './api';
import { bearing, decodeBeacon, encodeBeacon, proximity, type Beacon } from './beacon-codec';
import { distanceM } from './navigation';
import { beaconContacts, readBeaconIdentity, validBeaconId, writeBeaconIdentity, type BeaconIdentity } from './beacon-cache';

export type BeaconPerson = Beacon & { lastHeard: number; rssi: number; name: string | null; distance: number | null; uncertainty: number | null; direction: number | null; signal: ReturnType<typeof proximity> };
type Heard = { beacon: Beacon; rssi: number; lastHeard: number; payloadReceivedAt: number };
const FRESH_FIX_MS = 30000;
let nativeWork: Promise<unknown> = Promise.resolve();
const nativeTask = <T,>(task: () => Promise<T>): Promise<T> => {
  const next = nativeWork.catch(() => {}).then(task);
  nativeWork = next;
  return next;
};

export function useBeacons({ accountId, role, active, token, optedIn, contacts = [], incomingContacts = [], contactsReady = false, refresh }: { accountId: string; role: 1 | 2; active: boolean; token: string; optedIn: boolean; contacts?: Contact[]; incomingContacts?: Contact[]; contactsReady?: boolean; refresh: (requestId?: string) => Promise<unknown> }) {
  const [identity, setIdentity] = useState<{ accountId: string; value: BeaconIdentity } | null>(null);
  const [status, setStatus] = useState<BeaconModule.BeaconState['status']>('idle');
  const [advertising, setAdvertising] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [offline, setOffline] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [heard, setHeard] = useState<Map<number, Heard>>(new Map());
  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const latest = useRef({ offline, refresh, position });
  latest.current = { offline, refresh, position };
  const serverIdentity = useRef<string | null>(null);
  const cache = identity?.accountId === accountId ? identity.value : null;
  const savedContacts = JSON.stringify(beaconContacts(contacts, incomingContacts));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setForeground(next === 'active'));
    let alive = true;
    const network = NetInfo.addEventListener(next => { if (alive) setOffline(next.isConnected !== true || next.isInternetReachable === false); });
    void NetInfo.fetch().then(next => { if (alive) setOffline(next.isConnected !== true || next.isInternetReachable === false); }).catch(() => {});
    return () => { alive = false; subscription.remove(); network(); };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setIdentity(null);
    void readBeaconIdentity(accountId).then(async value => {
      if (!alive) return;
      setIdentity({ accountId, value });
    }).catch(() => {});
    return () => { alive = false; };
  }, [accountId, token]);

  useEffect(() => {
    const accountKey = `${accountId}:${token}`;
    if (!cache || offline || !token || serverIdentity.current === accountKey) return;
    const abort = new AbortController();
    void buddyRequest<{ beaconId: number }>(token, '/me/beacon', 'GET', undefined, abort.signal).then(result => {
      if (abort.signal.aborted || !validBeaconId(result.beaconId)) return;
      serverIdentity.current = accountKey;
      setIdentity(current => current?.accountId === accountId ? { accountId, value: { ...current.value, beaconId: result.beaconId } } : current);
    }).catch(() => {});
    return () => abort.abort();
  }, [accountId, token, offline, cache?.beaconId]);

  useEffect(() => {
    if (!cache) return;
    const next = contactsReady ? { ...cache, contacts: JSON.parse(savedContacts) as BeaconIdentity['contacts'] } : cache;
    if (JSON.stringify(next.contacts) !== JSON.stringify(cache.contacts)) setIdentity({ accountId, value: next });
    void writeBeaconIdentity(accountId, next).catch(() => {});
  }, [accountId, cache, contactsReady, savedContacts]);

  const enabled = active && foreground && Boolean(cache);
  const advertise = role === 1 || optedIn;
  const beaconId = cache?.beaconId;
  useEffect(() => {
    setHeard(new Map()); setPosition(null); setHeading(null); setAdvertising(false); setLocationDenied(false);
    if (!enabled || !beaconId) { setStatus('idle'); return; }
    if (!BeaconModule.available) { setStatus('unavailable'); return; }
    let alive = true;
    const abort = new AbortController();
    let positionWatch: Location.LocationSubscription | undefined;
    let headingWatch: Location.LocationSubscription | undefined;
    let lastClaim = -Infinity;
    let claiming = false;
    const claims = new Map<number, number>();
    const peers = new Map<number, Heard>();
    const devices = new Map<string, number>();
    let fix: Location.LocationObject | null = null;
    const payload = () => {
      const fresh = fix && Date.now() - fix.timestamp <= FRESH_FIX_MS && fix.timestamp <= Date.now() + 5000;
      return Array.from(encodeBeacon({ role, beaconId, latitude: fresh ? fix!.coords.latitude : null, longitude: fresh ? fix!.coords.longitude : null, accuracy: fresh ? fix!.coords.accuracy : null }));
    };
    const updateState = (value: BeaconModule.BeaconState) => { if (alive) { setStatus(value.status); setAdvertising(value.advertising); } };
    const claim = async () => {
      if (!alive || claiming || latest.current.offline || !optedIn || role !== 2 || Date.now() - lastClaim < 3000) return;
      const ids = [...peers.entries()].filter(([id, peer]) => peer.beacon.role === 1 && Date.now() - peer.lastHeard < 30000 && Date.now() - (claims.get(id) ?? -Infinity) >= 30000).slice(0, 10).map(([id]) => id);
      if (!ids.length) return;
      claiming = true; lastClaim = Date.now(); ids.forEach(id => claims.set(id, Date.now()));
      try {
        const sessions = await buddyRequest<Session[]>(token, '/nearby/beacons', 'POST', { beaconIds: ids }, abort.signal);
        if (alive && sessions.length) await latest.current.refresh(sessions[0].id);
      } catch {} finally { claiming = false; }
    };
    const onBeacon = BeaconModule.addBeaconListener(event => {
      if (!alive || AppState.currentState !== 'active') return;
      const beacon = event.payload ? decodeBeacon(event.payload) : null;
      if (beacon?.beaconId === beaconId) return;
      if (beacon) {
        devices.set(event.deviceId, beacon.beaconId);
        peers.set(beacon.beaconId, { beacon, rssi: event.rssi, lastHeard: Date.now(), payloadReceivedAt: Date.now() });
      } else if (!event.payload) {
        const id = devices.get(event.deviceId);
        const peer = id === undefined ? null : peers.get(id);
        if (peer) peers.set(id!, { ...peer, rssi: event.rssi, lastHeard: Date.now() });
      }
      setHeard(new Map(peers)); void claim();
    });
    const onState = BeaconModule.addStateListener(updateState);
    const watchLocation = async () => {
      if (!alive || AppState.currentState !== 'active') return;
      const watch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 1 }, value => { if (alive) { fix = value; setPosition(value); } });
      if (!alive) { watch.remove(); return; } positionWatch = watch;
      try {
        const watchHeading = await Location.watchHeadingAsync(value => { if (alive) setHeading(value.trueHeading >= 0 ? value.trueHeading : value.magHeading >= 0 ? value.magHeading : null); });
        if (!alive) watchHeading.remove(); else headingWatch = watchHeading;
      } catch {}
    };
    setStatus('starting');
    void nativeTask(async () => {
      if (!alive || AppState.currentState !== 'active') return;
      const permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!alive || AppState.currentState !== 'active') return;
      if (Platform.OS === 'android' && (permission?.status !== 'granted' || permission.android?.accuracy === 'coarse')) { setLocationDenied(true); setStatus('unauthorized'); return; }
      if (!await BeaconModule.requestPermissions()) { if (alive) setStatus('unauthorized'); return; }
      if (!alive || AppState.currentState !== 'active') return;
      updateState(await BeaconModule.start({ payload: payload(), advertise }));
      if (permission?.status === 'granted') void watchLocation().catch(() => {});
    }).catch(() => { if (alive) setStatus('error'); });
    const timer = setInterval(() => {
      if (!alive) return;
      setNow(Date.now());
      for (const [id, peer] of peers) if (Date.now() - peer.lastHeard >= 30000) peers.delete(id);
      setHeard(new Map(peers)); void claim();
    }, 1000);
    const broadcast = setInterval(() => { void nativeTask(async () => { if (alive) await BeaconModule.update(payload()); }).catch(() => {}); }, 10000);
    return () => {
      alive = false; abort.abort(); clearInterval(timer); clearInterval(broadcast); positionWatch?.remove(); headingWatch?.remove(); onBeacon.remove(); onState.remove();
      void nativeTask(() => BeaconModule.stop()).catch(() => {});
    };
  }, [enabled, beaconId, role, advertise, optedIn, token]);

  const fresh = position && now - position.timestamp <= FRESH_FIX_MS && position.timestamp <= now + 5000;
  const people: BeaconPerson[] = !enabled ? [] : [...heard.values()].filter(peer => now - peer.lastHeard < 30000).map(peer => {
    const point = now - peer.payloadReceivedAt <= FRESH_FIX_MS && peer.beacon.latitude !== null && peer.beacon.longitude !== null ? { latitude: peer.beacon.latitude, longitude: peer.beacon.longitude } : null;
    const ownAccuracy = position?.coords.accuracy;
    const uncertainty = fresh && point && ownAccuracy !== null && ownAccuracy !== undefined && peer.beacon.accuracy !== null ? ownAccuracy + peer.beacon.accuracy : null;
    const distance = fresh && point && uncertainty !== null ? distanceM(position!.coords, point) : null;
    const direction = distance !== null && uncertainty !== null && distance > uncertainty && heading !== null ? (bearing(position!.coords, point!) - heading + 360) % 360 : null;
    return { ...peer.beacon, ...peer, name: cache?.contacts.find(contact => contact.beaconId === peer.beacon.beaconId)?.name ?? null, distance, uncertainty, direction, signal: proximity(peer.rssi) };
  }).sort((left, right) => left.role - right.role || (left.distance ?? Infinity) - (right.distance ?? Infinity));
  return { status, advertising, people, offline, locationDenied };
}
