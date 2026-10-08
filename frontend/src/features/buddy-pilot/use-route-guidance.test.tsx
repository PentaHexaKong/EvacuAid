import { act, renderHook } from '@testing-library/react-native';
import type { BuddyRoute, Position } from './api';
import { useRouteGuidance } from './use-route-guidance';

const route: BuddyRoute = { routeStatus: 'READY', leg: 'TO_SHELTER', destination: { name: 'Shelter', latitude: 0.001, longitude: 0.001 }, evaluation: null, selectionReasonCodes: [], route: { geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]] }, distanceM: 222, durationSec: 180, profile: 'PEDESTRIAN', maneuvers: [{ instruction: 'East', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 111, durationSec: 90, type: 1, streetNames: ['Jalan Melati'] }, { instruction: 'North', beginShapeIndex: 1, endShapeIndex: 2, distanceM: 111, durationSec: 90, type: 15 }] } };
const fix = (latitude: number, longitude: number): Position => ({ latitude, longitude, accuracyM: 5, observedAt: new Date(Date.now()).toISOString() });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('guidance reports the turn, distances and walked share, and speaks each turn once', () => {
  const speak = jest.fn().mockResolvedValue(undefined);
  const onInstruction = jest.fn();
  const view = renderHook((position: Position | null) => useRouteGuidance({ route, position, target: null, language: 'id', reroute: jest.fn(), speak, voiceEnabled: true, onInstruction }), { initialProps: fix(0, 0.0005) });
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current).toEqual(expect.objectContaining({ ready: true, instruction: 'Mulai berjalan di Jalan Melati', minutes: 3 }));
  expect(view.result.current.nextManeuverM).toBeCloseTo(55.6, 0);
  expect(view.result.current.walked).toBeCloseTo(0.25, 1);
  expect(view.result.current.next?.type).toBe(15);
  expect(onInstruction).toHaveBeenLastCalledWith('Mulai berjalan di Jalan Melati');
  act(() => { jest.advanceTimersByTime(1000); });
  view.rerender(fix(0, 0.0006));
  act(() => { jest.advanceTimersByTime(1); });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak).toHaveBeenCalledWith('Mulai berjalan di Jalan Melati');
});

test('three fixes off the route ask for a new route once, then not again for 15 seconds', () => {
  const reroute = jest.fn();
  const view = renderHook((position: Position | null) => useRouteGuidance({ route, position, target: null, language: 'en', reroute, speak: jest.fn(), voiceEnabled: false, onInstruction: jest.fn() }), { initialProps: fix(0.001, 0.0004) });
  const move = (step: number) => { act(() => { jest.advanceTimersByTime(1000); }); view.rerender(fix(0.001, 0.0004 + step * 0.000001)); act(() => { jest.advanceTimersByTime(1); }); };
  act(() => { jest.advanceTimersByTime(1); });
  move(1); expect(reroute).not.toHaveBeenCalled();
  move(2); expect(reroute).toHaveBeenCalledTimes(1);
  move(3); move(4); move(5); move(6);
  expect(reroute).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(15000); });
  move(7); move(8); move(9);
  expect(reroute).toHaveBeenCalledTimes(2);
});

test('without a usable fix there is no turn to show', () => {
  const onInstruction = jest.fn();
  const view = renderHook(() => useRouteGuidance({ route, position: { ...fix(0, 0.0005), accuracyM: 80 }, target: null, language: 'id', reroute: jest.fn(), speak: jest.fn(), voiceEnabled: true, onInstruction }));
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current).toEqual(expect.objectContaining({ progress: null, instruction: null, walked: 0 }));
  expect(onInstruction).toHaveBeenLastCalledWith(null);
});
