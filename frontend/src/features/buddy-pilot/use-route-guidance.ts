import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import en from '@/localization/en.json';
import id from '@/localization/id.json';
import type { BuddyRoute, Position } from './api';
import { distanceM, instructionText, routeProgress } from './navigation';

const REROUTE_GAP_MS = 15000;
// How far before a turn it is announced again, close enough to act on at walking pace.
export const CUE_M = 40;

// Follows the walker along a route: where they are on it, the current and next turn, and when to ask for a new route.
// The session card and the navigation view both read from this one source.
export function useRouteGuidance({ route, position, target, language, reroute, speak, voiceEnabled, haptics, cue, onInstruction, entranceNote, destinationName, waitingName, caption }: { route: BuddyRoute | null; position: Position | null; target: Position | null; language: 'id' | 'en'; reroute: () => void; speak: (text: string) => Promise<void>; voiceEnabled: boolean; haptics: boolean; cue: (text: string) => string; onInstruction: (text: string | null) => void; entranceNote?: string | null; destinationName?: string | null; waitingName?: string | null; caption?: (text: string) => void }) {
  const [tracked, setTracked] = useState<{ route: BuddyRoute | null; progress: ReturnType<typeof routeProgress> }>({ route, progress: null });
  const progress = tracked.route === route ? tracked.progress : null;
  const [arrivedRoute, setArrivedRoute] = useState<BuddyRoute | null>(null);
  const offRoute = useRef({ count: 0, lastFix: '', lastReroute: 0 });
  const spoken = useRef('');
  const previous = useRef<{ route: BuddyRoute | null; segment: number }>({ route, segment: 0 });
  useEffect(() => {
    const update = () => {
      // A route to a person stays usable when their location stops updating: it still leads to where they last were.
      const next = position && route?.route ? routeProgress(position, route.route.geometry.coordinates, route.route.maneuvers, Date.now(), previous.current.route === route ? previous.current.segment : 0) : null;
      if (next) previous.current = { route, segment: next.segmentIndex };
      setTracked({ route, progress: next ? { ...next, nearDestination: next.remainingM <= 10 && distanceM(position!, { longitude: route!.route!.geometry.coordinates.at(-1)![0], latitude: route!.route!.geometry.coordinates.at(-1)![1] }) <= 10 } : null });
    };
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [route, position]);

  const path = route?.route ?? null;
  const maneuver = progress && path ? path.maneuvers[progress.maneuverIndex] ?? null : null;
  const next = progress && path ? path.maneuvers[progress.maneuverIndex + 1] ?? null : null;
  const instruction = maneuver ? instructionText(maneuver, language) : null;
  const act = useEffectEvent((kind: 'instruction' | 'reroute' | 'speak', text: string | null = null) => {
    if (kind === 'instruction') onInstruction(text);
    else if (kind === 'reroute') reroute();
    else if (text) { caption?.(text); if (voiceEnabled) void speak(text); }
  });
  useEffect(() => {
    act('instruction', instruction);
    if (!progress || !route) { offRoute.current.count = 0; return; }
    const now = Date.now();
    if (route.leg === 'TO_REQUESTER' && target && route.destination && now - Date.parse(target.observedAt) <= 30000 && target.accuracyM <= 30 && distanceM(target, route.destination) > 30 && now - offRoute.current.lastReroute >= REROUTE_GAP_MS) { offRoute.current.lastReroute = now; offRoute.current.count = 0; act('reroute'); return; }
    if (!position || offRoute.current.lastFix === position.observedAt) return;
    offRoute.current.lastFix = position.observedAt;
    offRoute.current.count = progress.offRouteM > 30 ? offRoute.current.count + 1 : 0;
    if (offRoute.current.count >= 3 && now - offRoute.current.lastReroute >= REROUTE_GAP_MS) { offRoute.current.count = 0; offRoute.current.lastReroute = now; act('reroute'); }
    const key = maneuver && `${route.leg}:${maneuver.beginShapeIndex}:${instruction}`;
    if (key && progress.offRouteM <= 30 && spoken.current !== key) { spoken.current = key; act('speak', instruction); }
  }, [route, progress, position, target, maneuver, instruction]);

  // One more announcement shortly before each turn, and a tap on the wrist for people who navigate without sound.
  const upcoming = next ? instructionText(next, language) : null;
  const cued = useRef('');
  const arrival = useRef<{ route: BuddyRoute | null; near: boolean; middle: boolean; here: boolean }>({ route: null, near: false, middle: false, here: false });
  const nudge = useEffectEvent((kind: 'turn' | 'near' | 'middle' | 'arrive') => {
    const copy = language === 'id' ? id : en;
    if (kind === 'near') act('speak', `${copy.arriveNear.replace('{{distance}}', String(Math.round(progress?.remainingM ?? 30))).replace('{{name}}', destinationName ?? route?.destination?.name ?? '')}${entranceNote ? ` ${entranceNote}` : ''}`);
    if (kind === 'arrive') act('speak', waitingName ? copy.arriveWaiting.replace('{{name}}', waitingName) : copy.arriveHere);
    if (kind === 'turn' && upcoming) act('speak', cue(upcoming));
    if (haptics) void (kind === 'arrive' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(kind === 'middle' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
  });
  useEffect(() => {
    if (!progress || !route || progress.offRouteM > 30) return;
    if (arrival.current.route !== route) { arrival.current = { route, near: false, middle: false, here: false }; cued.current = ''; }
    const cues = arrival.current;
    if (progress.nearDestination) { if (!cues.here) { cues.here = true; setArrivedRoute(route); nudge('arrive'); } return; }
    if (cues.here) return;
    if (progress.remainingM <= 30 && !cues.near) { cues.near = true; nudge('near'); }
    if (progress.remainingM < 20 && progress.remainingM > 10 && !cues.middle) { cues.middle = true; nudge('middle'); }
    const key = next && `${route.leg}:${next.beginShapeIndex}`;
    if (key && progress.nextManeuverM <= CUE_M && cued.current !== key) { cued.current = key; nudge('turn'); }
  }, [route, progress, next]);

  const lengthM = useMemo(() => (path?.geometry.coordinates ?? []).reduce((total, point, index, points) => index ? total + distanceM({ longitude: points[index - 1][0], latitude: points[index - 1][1] }, { longitude: point[0], latitude: point[1] }) : 0, 0), [path]);
  const remainingM = progress ? progress.remainingM : path?.distanceM ?? 0;
  const minutes = path ? Math.max(1, Math.ceil(path.durationSec * (progress ? progress.remainingM / Math.max(1, path.distanceM) : 1) / 60)) : 0;
  return { arrived: Boolean(route && arrivedRoute === route), ready: Boolean(path), progress, maneuver, next, after: progress && path ? path.maneuvers[progress.maneuverIndex + 2] ?? null : null, instruction, upcoming, remainingM, minutes, nextManeuverM: progress?.nextManeuverM ?? 0, walked: progress && lengthM ? Math.min(1, Math.max(0, 1 - progress.remainingM / lengthM)) : 0 };
}

export type RouteGuidance = ReturnType<typeof useRouteGuidance>;
