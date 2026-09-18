export type ParticipantId = 'you' | 'buddy';
export type Position = { latitude: number; longitude: number; observedAt: number; accuracy?: number };
export type Participant = { id: ParticipantId; position: Position | null };
export type LocationSnapshot = { participants: Participant[]; connection: 'connected' | 'disconnected' };
export type LocationSource = { subscribe: (listener: (snapshot: LocationSnapshot) => void) => () => void };
export const STALE_AFTER_MS = 15_000;

export function positionStatus(position: Position | null, now: number) {
  if (!position) return 'unavailable';
  return now - position.observedAt >= STALE_AFTER_MS ? 'stale' : 'current';
}

export function createSimulatedSource(now: () => number = Date.now) {
  const listeners = new Set<(snapshot: LocationSnapshot) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0;
  let connected = true;
  let moving = true;
  let unavailable = false;
  let snapshot: LocationSnapshot;
  const createSnapshot = (): LocationSnapshot => ({
    connection: connected ? 'connected' : 'disconnected',
    participants: [
      { id: 'you', position: { latitude: -6.1754, longitude: 106.8272, observedAt: now(), accuracy: 12 } },
      { id: 'buddy', position: unavailable ? null : {
        latitude: -6.178 + Math.sin(step / 8) * 0.001,
        longitude: 106.830 + Math.cos(step / 8) * 0.001,
        observedAt: now(), accuracy: 18,
      } },
    ],
  });
  const emit = () => listeners.forEach((listener) => listener(snapshot));
  return {
    subscribe(listener: (snapshot: LocationSnapshot) => void) {
      if (listeners.size === 0) {
        step = 0;
        connected = true;
        moving = true;
        unavailable = false;
        snapshot = createSnapshot();
        timer = setInterval(() => {
          if (!connected) return;
          if (moving) step += 1;
          snapshot = createSnapshot();
          emit();
        }, 2000);
      }
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    setMoving(value: boolean) { moving = value; },
    interrupt() {
      connected = false;
      snapshot = { ...snapshot, connection: 'disconnected' };
      emit();
    },
    recover() { connected = true; snapshot = createSnapshot(); emit(); },
    setUnavailable(value: boolean) {
      unavailable = value;
      if (connected) { snapshot = createSnapshot(); emit(); }
    },
  } satisfies LocationSource & Record<string, unknown>;
}
