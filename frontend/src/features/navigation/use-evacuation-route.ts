import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccess } from '@/features/access/use-access';
import * as Location from 'expo-location';
import { ensureForeground } from '@/features/location/permissions';
import { useGuestSession } from '@/features/profile/session';
import type { ApiError } from '@/features/profile/api';
import { nearbyShelters, requestRoute, toCoordinates, type Coordinate, type NavigationResponse, type Origin, type Shelter } from './api';

export type Phase = 'needsLocation' | 'locating' | 'denied' | 'located' | 'routing' | 'ready' | 'unavailable' | 'error';
export type RouteResult = { coordinates: Coordinate[]; response: NavigationResponse; computedAt: Date };
export type EvacuationState = { phase: Phase; origin: Origin | null; shelters: Shelter[] | null; route: RouteResult | null; reason: string | null; errorKind: ApiError['kind'] | 'session' | 'unknown' | null };

const FRESH_MS = 60_000;
const initial: EvacuationState = { phase: 'needsLocation', origin: null, shelters: null, route: null, reason: null, errorKind: null };

async function fix(origin: Origin | null, askPermission: boolean): Promise<Origin | null> {
  if (origin && Date.now() - Date.parse(origin.observedAt) < FRESH_MS) return origin;
  const granted = askPermission ? await ensureForeground() === 'granted' : (await Location.getForegroundPermissionsAsync()).granted;
  if (!granted) return null;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy ?? null, observedAt: new Date(Math.min(position.timestamp, Date.now())).toISOString() };
}

export function useEvacuationRoute(routeRequest?: string) {
  const session = useGuestSession();
  const sessionRef = useRef(session);
  const { stepFree } = useAccess();
  const stepFreeRef = useRef(stepFree);
  useEffect(() => { stepFreeRef.current = stepFree; });
  useEffect(() => { sessionRef.current = session; });
  const [state, setState] = useState(initial);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
  }, []);
  const begin = useCallback(() => {
    cancel();
    controller.current = new AbortController();
    return { id: generation.current, signal: controller.current.signal };
  }, [cancel]);
  const fail = useCallback((id: number, cause: unknown) => {
    if (id !== generation.current || (cause as Error)?.name === 'AbortError') return;
    setState(value => ({ ...value, phase: 'error', errorKind: (cause as ApiError)?.kind ?? 'unknown' }));
  }, []);

  const findRoute = useCallback(async (destinationShelterId?: string, currentOrigin?: Origin) => {
    const { id, signal } = begin();
    const live = () => id === generation.current;
    setState(value => ({ ...value, route: null, phase: value.origin ? 'routing' : 'locating', reason: null, errorKind: null }));
    try {
      const origin = await fix(currentOrigin ?? state.origin, true);
      if (!live()) return;
      if (!origin) { setState(value => ({ ...value, phase: 'denied' })); return; }
      const { token, user } = sessionRef.current;
      if (!token || !user) { setState(value => ({ ...value, origin, phase: 'error', errorKind: 'session' })); return; }
      setState(value => ({ ...value, origin, phase: 'routing' }));
      const [shelters, response] = await Promise.all([
        nearbyShelters(origin, signal),
        requestRoute({ userId: user.id, origin, ...(stepFreeRef.current ? { profile: 'WHEELCHAIR' as const } : {}), ...(destinationShelterId ? { destinationShelterId } : {}) }, token, signal),
      ]);
      if (!live()) return;
      if (response.routeStatus !== 'READY' || !response.route) {
        setState(value => ({ ...value, shelters, route: null, phase: 'unavailable', reason: response.evaluation?.reasonCodes[0] ?? response.selectionReasonCodes[0] ?? null }));
        return;
      }
      const route = { coordinates: toCoordinates(response.route.geometry), response, computedAt: new Date() };
      setState(value => ({ ...value, shelters, route, phase: 'ready' }));
    } catch (cause) { fail(id, cause); }
  }, [begin, fail, state.origin]);

  const locate = useCallback(async (askPermission: boolean) => {
    const { id, signal } = begin();
    const live = () => id === generation.current;
    if (askPermission) setState(value => ({ ...value, route: null, shelters: null, phase: 'locating' }));
    try {
      const origin = await fix(null, askPermission);
      if (!live()) return;
      if (!origin) { if (askPermission) setState(value => ({ ...value, phase: 'denied' })); return; }
      setState(value => ({ ...value, origin, phase: 'located' }));
      const shelters = await nearbyShelters(origin, signal);
      if (live()) setState(value => ({ ...value, shelters }));
    } catch (cause) { fail(id, cause); }
  }, [begin, fail]);

  const clearRoute = useCallback(() => {
    cancel();
    setState(value => ({ ...value, route: null, reason: null, errorKind: null, phase: value.origin ? 'located' : 'needsLocation' }));
  }, [cancel]);

  const findRouteRef = useRef(findRoute);
  useEffect(() => { findRouteRef.current = findRoute; });
  useEffect(() => {
    if (!routeRequest) return;
    const start = setTimeout(() => { void findRouteRef.current(); }, 0);
    return () => clearTimeout(start);
  }, [routeRequest]);

  useEffect(() => {
    const mounted = generation.current;
    Location.getForegroundPermissionsAsync().then(permission => { if (permission.granted && generation.current === mounted) void locate(false); }).catch(() => {});
    return cancel;
  }, [locate, cancel]);

  return { ...state, findRoute, locate: () => locate(true), clearRoute };
}
