import { act, renderHook } from '@testing-library/react-native';
import type { BuddyRoute, Position } from './api';
import { useRouteGuidance } from './use-route-guidance';

const route: BuddyRoute = { routeStatus: 'READY', leg: 'TO_SHELTER', destination: { name: 'Shelter', latitude: 0.001, longitude: 0.001 }, evaluation: null, selectionReasonCodes: [], route: { geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]] }, distanceM: 222, durationSec: 180, profile: 'PEDESTRIAN', maneuvers: [{ instruction: 'East', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 111, durationSec: 90, type: 1, streetNames: ['Jalan Melati'] }, { instruction: 'North', beginShapeIndex: 1, endShapeIndex: 2, distanceM: 111, durationSec: 90, type: 15 }] } };
const cue = (text: string) => `In 40 metres, ${text}`;
const mockImpact = jest.fn().mockResolvedValue(undefined);
const mockNotify = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-haptics', () => ({ impactAsync: (...args: unknown[]) => mockImpact(...args), notificationAsync: (...args: unknown[]) => mockNotify(...args), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success' } }));
const fix = (latitude: number, longitude: number): Position => ({ latitude, longitude, accuracyM: 5, observedAt: new Date(Date.now()).toISOString() });

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

test('guidance reports the turn, distances and walked share, and speaks each turn once', () => {
  const speak = jest.fn().mockResolvedValue(undefined);
  const onInstruction = jest.fn();
  const view = renderHook((position: Position | null) => useRouteGuidance({ route, position, target: null, language: 'id', reroute: jest.fn(), speak, voiceEnabled: true, haptics: true, cue, onInstruction }), { initialProps: fix(0, 0.0005) });
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
  const view = renderHook((position: Position | null) => useRouteGuidance({ route, position, target: null, language: 'en', reroute, speak: jest.fn(), voiceEnabled: false, haptics: true, cue, onInstruction: jest.fn() }), { initialProps: fix(0.001, 0.0004) });
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
  const view = renderHook(() => useRouteGuidance({ route, position: { ...fix(0, 0.0005), accuracyM: 80 }, target: null, language: 'id', reroute: jest.fn(), speak: jest.fn(), voiceEnabled: true, haptics: true, cue, onInstruction }));
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current).toEqual(expect.objectContaining({ progress: null, instruction: null, walked: 0 }));
  expect(onInstruction).toHaveBeenLastCalledWith(null);
});

test.each([true, false])('40 metres before a turn it is announced once with a tap, and arrival taps once (voice %s)', voiceEnabled => {
  const speak = jest.fn().mockResolvedValue(undefined);
  const view = renderHook((position: Position | null) => useRouteGuidance({ route, position, target: null, language: 'en', reroute: jest.fn(), speak, voiceEnabled, haptics: true, cue, onInstruction: jest.fn() }), { initialProps: fix(0, 0.0003) });
  const move = (latitude: number, longitude: number) => { act(() => { jest.advanceTimersByTime(1000); }); view.rerender(fix(latitude, longitude)); act(() => { jest.advanceTimersByTime(1); }); };
  act(() => { jest.advanceTimersByTime(1); });
  expect(mockImpact).not.toHaveBeenCalled();
  move(0, 0.0007); move(0, 0.00075); move(0, 0.0008);
  expect(mockImpact).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls.filter(call => call[0] === 'In 40 metres, Turn left')).toHaveLength(voiceEnabled ? 1 : 0);
  move(0.0009, 0.001); move(0.00095, 0.001);
  expect(mockNotify).toHaveBeenCalledTimes(1);
});

test('the walk to a person keeps its turns when their location stops updating', () => {
  const toPerson: BuddyRoute = { ...route, leg: 'TO_REQUESTER' };
  const view = renderHook(() => useRouteGuidance({ route: toPerson, position: fix(0, 0.0005), target: null, language: 'en', reroute: jest.fn(), speak: jest.fn(), voiceEnabled: false, haptics: false, cue, onInstruction: jest.fn() }));
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current.progress).not.toBeNull();
  expect(view.result.current.next?.type).toBe(15);
});


test.each([null, 'Use the east entrance'])('arrival cues speak and caption once per route, including entrance note %s', entranceNote => {
  const speak = jest.fn().mockResolvedValue(undefined);
  const caption = jest.fn();
  const view = renderHook(({ position, path }: { position: Position; path: BuddyRoute }) => useRouteGuidance({ route: path, position, target: null, language: 'en', reroute: jest.fn(), speak, voiceEnabled: true, haptics: true, cue, onInstruction: jest.fn(), destinationName: 'Town Hall', entranceNote, caption }), { initialProps: { position: fix(0.00074, 0.001), path: route } });
  act(() => { jest.advanceTimersByTime(1); });
  const near = `You're 29 m from Town Hall.${entranceNote ? ` ${entranceNote}` : ''}`;
  expect(speak.mock.calls.filter(call => call[0] === near)).toHaveLength(1);
  expect(caption).toHaveBeenCalledWith(near);
  expect(mockImpact).toHaveBeenCalledWith('light');
  const move = (latitude: number, path = route) => { act(() => { jest.advanceTimersByTime(1000); }); view.rerender({ position: fix(latitude, 0.001), path }); act(() => { jest.advanceTimersByTime(1); }); };
  move(0.00076);
  expect(speak.mock.calls.filter(call => call[0] === near)).toHaveLength(1);
  move(0.00083); move(0.00085);
  expect(mockImpact.mock.calls.filter(call => call[0] === 'medium')).toHaveLength(1);
  expect(speak).not.toHaveBeenCalledWith("You've arrived.");
  move(0.00093); move(0.00095);
  expect(speak.mock.calls.filter(call => call[0] === "You've arrived.")).toHaveLength(1);
  expect(caption).toHaveBeenCalledWith("You've arrived.");
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(view.result.current.arrived).toBe(true);
  const rerouted = { ...route };
  move(0.00074, rerouted);
  expect(view.result.current.arrived).toBe(false);
  expect(speak.mock.calls.filter(call => call[0] === near)).toHaveLength(2);
  move(0.00083, rerouted); move(0.00093, rerouted);
  expect(mockImpact.mock.calls.filter(call => call[0] === 'medium')).toHaveLength(2);
  expect(mockNotify).toHaveBeenCalledTimes(2);
});

test.each([true, false])('arrival names the person waiting and captions even without voice (%s)', voiceEnabled => {
  const speak = jest.fn().mockResolvedValue(undefined);
  const caption = jest.fn();
  const view = renderHook((position: Position) => useRouteGuidance({ route, position, target: null, language: 'en', reroute: jest.fn(), speak, voiceEnabled, haptics: true, cue, onInstruction: jest.fn(), waitingName: 'Sari', caption }), { initialProps: fix(0.00074, 0.001) });
  act(() => { jest.advanceTimersByTime(1); });
  expect(caption).toHaveBeenCalledWith("You're 29 m from Shelter.");
  act(() => { jest.advanceTimersByTime(1000); });
  view.rerender(fix(0.00095, 0.001));
  act(() => { jest.advanceTimersByTime(1); });
  const text = "You've arrived. Sari is waiting at the entrance.";
  expect(caption).toHaveBeenCalledWith(text);
  expect(mockNotify).toHaveBeenCalledTimes(1);
  if (voiceEnabled) expect(speak).toHaveBeenCalledWith(text); else expect(speak).not.toHaveBeenCalled();
});

test('arrival cues do not fire off route and remain arrived after moving away', () => {
  const caption = jest.fn();
  const view = renderHook((position: Position) => useRouteGuidance({ route, position, target: null, language: 'id', reroute: jest.fn(), speak: jest.fn(), voiceEnabled: false, haptics: true, cue, onInstruction: jest.fn(), caption }), { initialProps: fix(0.00095, 0.0015) });
  act(() => { jest.advanceTimersByTime(1); });
  expect(mockNotify).not.toHaveBeenCalled();
  expect(mockImpact).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1000); });
  view.rerender(fix(0.00095, 0.001));
  act(() => { jest.advanceTimersByTime(1); });
  expect(caption).toHaveBeenCalledWith('Kamu sudah sampai.');
  act(() => { jest.advanceTimersByTime(1000); });
  view.rerender(fix(0.0008, 0.001));
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current.arrived).toBe(true);
  expect(mockImpact).not.toHaveBeenCalled();
});
