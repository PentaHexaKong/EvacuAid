import { useSyncExternalStore } from 'react';
import { buddyRequest } from './api';

type Point = { latitude: number; longitude: number };
type Leg = 'TOGETHER' | 'APPROACH';
// self is where this phone's person stands: walking along the route together, or waiting while the helper approaches.
export type DevWalk = { sessionId: string; leg: Leg; progress: number; distanceM: number; geometry: [number, number][]; self: Point; destination: Point };
type Step = { walk: { origin: Point; geometry: [number, number][]; distanceM: number; progress: number; latitude: number; longitude: number; destination: Point } };

// 24 steps 1.5 s apart: about 300 m in 36 s, a sped-up walk that still reads as walking on the map.
const STEPS = 24;
const TICK_MS = 1500;

let current: DevWalk | null = null;
// Sessions started by the simulated Buddy: once the requester confirms meeting, they walk on to the safe house by themselves.
const simulated = new Set<string>();
const listeners = new Set<() => void>();
const publish = (next: DevWalk | null) => { current = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const point = (value: Point): Point => ({ latitude: value.latitude, longitude: value.longitude });

// Development builds only. Module state, so the walk outlives the sheet re-rendering and the map reads the same position as the button.
export function useDevWalk(sessionId: string | undefined) {
  const walk = useSyncExternalStore(subscribe, () => current);
  return walk && walk.sessionId === sessionId ? walk : null;
}

export const isSimulatedHelper = (sessionId: string | undefined) => Boolean(sessionId && simulated.has(sessionId));
export const devWalking = () => Boolean(current && current.progress < 1);

// TOGETHER starts where this phone is when it knows; otherwise the server falls back to the last shared position.
// APPROACH starts at the simulated helper and ends at target, where the requester waits.
export async function startDevWalk(token: string, sessionId: string, onStep: () => void, start?: Point | null, leg: Leg = 'TOGETHER', target?: Point) {
  if (devWalking()) return;
  let origin: Point | undefined = start ? point(start) : undefined;
  // The route is the same every step; keeping the first array means the map sees one route, instead of a new one that redraws itself each tick.
  let geometry: [number, number][] | undefined;
  try {
    for (let step = 0; step <= STEPS; step++) {
      const { walk } = await buddyRequest<Step>(token, `/dev/requests/${sessionId}/simulate-walk`, 'POST', { progress: step / STEPS, leg, ...origin, ...(target ? { target: point(target) } : {}) });
      origin = walk.origin;
      geometry ??= walk.geometry;
      publish({ sessionId, leg, progress: walk.progress, distanceM: walk.distanceM, geometry, self: leg === 'APPROACH' && target ? target : { latitude: walk.latitude, longitude: walk.longitude }, destination: walk.destination });
      onStep();
      if (step < STEPS) await new Promise(resolve => setTimeout(resolve, TICK_MS));
    }
  } catch (cause) {
    publish(null);
    throw cause;
  }
}

// For the person who needs help: a simulated Buddy accepts at once and walks over from about 300 m away.
export async function startDevHelper(token: string, here: Point, onStep: (sessionId: string) => void) {
  const created = await buddyRequest<{ id: string; helperStart: Point }>(token, '/dev/simulate-helper', 'POST', point(here));
  simulated.add(created.id);
  onStep(created.id);
  await startDevWalk(token, created.id, () => onStep(created.id), created.helperStart, 'APPROACH', here);
}
