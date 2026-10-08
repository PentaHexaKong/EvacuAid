import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { BuddyRoute, Position } from './api';
import { distanceM, instructionText, routeProgress } from './navigation';

const REROUTE_GAP_MS = 15000;

// Follows the walker along a route: where they are on it, the current and next turn, and when to ask for a new route.
// The session card and the navigation view both read from this one source.
export function useRouteGuidance({ route, position, target, language, reroute, speak, voiceEnabled, onInstruction }: { route: BuddyRoute | null; position: Position | null; target: Position | null; language: 'id' | 'en'; reroute: () => void; speak: (text: string) => Promise<void>; voiceEnabled: boolean; onInstruction: (text: string | null) => void }) {
  const [progress, setProgress] = useState<ReturnType<typeof routeProgress>>(null);
  const offRoute = useRef({ count: 0, lastFix: '', lastReroute: 0 });
  const spoken = useRef('');
  const previous = useRef<{ route: BuddyRoute | null; segment: number }>({ route, segment: 0 });
  useEffect(() => {
    const update = () => {
      const next = position && route?.route && (route.leg !== 'TO_REQUESTER' || target) ? routeProgress(position, route.route.geometry.coordinates, route.route.maneuvers, Date.now(), previous.current.route === route ? previous.current.segment : 0) : null;
      if (next) previous.current = { route, segment: next.segmentIndex };
      setProgress(next);
    };
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [route, position, target]);

  const path = route?.route ?? null;
  const maneuver = progress && path ? path.maneuvers[progress.maneuverIndex] ?? null : null;
  const next = progress && path ? path.maneuvers[progress.maneuverIndex + 1] ?? null : null;
  const instruction = maneuver ? instructionText(maneuver, language) : null;
  const act = useEffectEvent((kind: 'instruction' | 'reroute' | 'speak', text: string | null = null) => {
    if (kind === 'instruction') onInstruction(text);
    else if (kind === 'reroute') reroute();
    else if (voiceEnabled && text) void speak(text);
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

  const lengthM = useMemo(() => (path?.geometry.coordinates ?? []).reduce((total, point, index, points) => index ? total + distanceM({ longitude: points[index - 1][0], latitude: points[index - 1][1] }, { longitude: point[0], latitude: point[1] }) : 0, 0), [path]);
  const remainingM = progress ? progress.remainingM : path?.distanceM ?? 0;
  const minutes = path ? Math.max(1, Math.ceil(path.durationSec * (progress ? progress.remainingM / Math.max(1, path.distanceM) : 1) / 60)) : 0;
  return { ready: Boolean(path), progress, maneuver, next, instruction, remainingM, minutes, nextManeuverM: progress?.nextManeuverM ?? 0, walked: progress && lengthM ? Math.min(1, Math.max(0, 1 - progress.remainingM / lengthM)) : 0 };
}

export type RouteGuidance = ReturnType<typeof useRouteGuidance>;
