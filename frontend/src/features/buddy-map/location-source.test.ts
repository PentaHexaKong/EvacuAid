import { createSimulatedSource, positionStatus, type LocationSnapshot } from './location-source';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-18T08:00:00Z')); });
afterEach(() => jest.useRealTimers());

test('marks missing and aged positions honestly at the 15-second boundary', () => {
  const p = { latitude: 0, longitude: 0, observedAt: 1000 };
  expect(positionStatus(null, 1000)).toBe('unavailable');
  expect(positionStatus(p, 15999)).toBe('current');
  expect(positionStatus(p, 16000)).toBe('stale');
});
test('moves deterministically and keeps timestamps fresh when movement is paused', () => {
  const source = createSimulatedSource();
  let latest!: LocationSnapshot;
  const stop = source.subscribe((value) => { latest = value; });
  const initial = latest.participants[1].position!;
  jest.advanceTimersByTime(2000);
  expect(latest.participants[1].position!.latitude).not.toBe(initial.latitude);
  source.setMoving(false);
  const paused = latest.participants[1].position!;
  jest.advanceTimersByTime(2000);
  expect(latest.participants[1].position!.latitude).toBe(paused.latitude);
  expect(latest.participants[1].position!.observedAt).toBeGreaterThan(paused.observedAt);
  stop();
});
test('retains the last known position during interruption and refreshes on recovery', () => {
  const source = createSimulatedSource();
  let latest!: LocationSnapshot;
  const stop = source.subscribe((value) => { latest = value; });
  const lastKnown = latest.participants[1].position;
  source.interrupt();
  jest.advanceTimersByTime(16000);
  expect(latest.connection).toBe('disconnected');
  expect(latest.participants[1].position).toEqual(lastKnown);
  expect(positionStatus(lastKnown, Date.now())).toBe('stale');
  source.recover();
  expect(latest.connection).toBe('connected');
  expect(positionStatus(latest.participants[1].position, Date.now())).toBe('current');
  source.setUnavailable(true);
  expect(latest.participants[1].position).toBeNull();
  source.setUnavailable(false);
  expect(latest.participants[1].position).not.toBeNull();
  stop();
});
test('cleans timers after the last subscriber leaves and restarts with a fresh snapshot', () => {
  const source = createSimulatedSource();
  const listener = jest.fn();
  const stop = source.subscribe(listener);
  source.interrupt();
  stop(); stop();
  const calls = listener.mock.calls.length;
  jest.advanceTimersByTime(20000);
  expect(listener).toHaveBeenCalledTimes(calls);
  expect(jest.getTimerCount()).toBe(0);
  const next = jest.fn();
  const stopNext = source.subscribe(next);
  expect(next.mock.calls[0][0].connection).toBe('connected');
  expect(next.mock.calls[0][0].participants[1].position.observedAt).toBe(Date.now());
  stopNext();
});
