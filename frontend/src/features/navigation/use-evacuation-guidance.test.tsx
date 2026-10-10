import { act, renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as routeGuidance from '@/features/buddy/use-route-guidance';
import { speak, stopSpeaking } from '@/features/feedback/speech';
import { useEvacuationGuidance } from './use-evacuation-guidance';
import type { NavigationResponse } from './api';

let mockSoundFree = false;
let mockListen = true;
let mockVibration = true;
const mockRemove = jest.fn();
let mockFix: (fix: Location.LocationObject) => void;
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { vibrationEnabled: mockVibration } }) }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, getCurrentPositionAsync: jest.fn(), watchPositionAsync: jest.fn((_options, callback) => { mockFix = callback; return Promise.resolve({ remove: mockRemove }); }) }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ listen: mockListen, soundFree: mockSoundFree }) }));
jest.mock('@/features/feedback/speech', () => ({ speak: jest.fn().mockResolvedValue(undefined), stopSpeaking: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
const response: NavigationResponse = { routeStatus: 'READY', destination: { shelterId: 'hall', name: 'Hall', latitude: 0, longitude: 0.001, entranceNote: 'East door' }, route: { distanceM: 111, durationSec: 120, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] }, profile: 'PEDESTRIAN', maneuvers: [{ instruction: 'Walk east', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 111, durationSec: 120, type: 1 }] }, evaluation: null, selectionReasonCodes: [] };

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); mockSoundFree = false; mockListen = true; mockVibration = true; });
afterEach(() => jest.useRealTimers());

test.each([false, true])('adapts a solo route, watches position, captions arrival and stops on unmount (sound free %s)', async soundFree => {
  mockSoundFree = soundFree;
  const engine = jest.spyOn(routeGuidance, 'useRouteGuidance');
  const view = renderHook(() => useEvacuationGuidance(response, jest.fn()));
  await act(async () => {});
  expect(Location.watchPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, expect.any(Function));
  act(() => mockFix({ coords: { latitude: 0, longitude: 0.00075, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject));
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.result.current.position?.longitude).toBe(0.00075);
  expect(view.result.current.instruction).toBe('Start walking');
  expect(view.result.current.caption).toBe("You're 28 m from Hall. East door");
  expect(view.result.current.ready).toBe(true);
  expect(engine).toHaveBeenCalledWith(expect.objectContaining({ route: expect.objectContaining({ leg: 'TO_SHELTER', route: expect.objectContaining({ maneuvers: response.route!.maneuvers, geometry: response.route!.geometry }) }), entranceNote: 'East door', destinationName: 'Hall' }));
  if (soundFree) expect(speak).not.toHaveBeenCalled(); else expect(speak).toHaveBeenCalledWith("You're 28 m from Hall. East door", 'en');
  view.unmount();
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

test('no route starts no watch, and a watch resolving after unmount is removed', async () => {
  const idle = renderHook(() => useEvacuationGuidance(null, jest.fn()));
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  idle.unmount();
  let resolve!: (value: Location.LocationSubscription) => void;
  jest.mocked(Location.watchPositionAsync).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useEvacuationGuidance(response, jest.fn()));
  view.unmount();
  await act(async () => resolve({ remove: mockRemove }));
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

test('listening disabled keeps guidance silent and reroutes on three fresh off-route fixes', async () => {
  mockListen = false;
  const reroute = jest.fn();
  const view = renderHook(() => useEvacuationGuidance(response, reroute));
  await act(async () => {});
  for (let index = 0; index < 6; index += 1) {
    act(() => { jest.advanceTimersByTime(1000); mockFix({ coords: { latitude: 0.001, longitude: 0.0005, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject); });
    act(() => { jest.advanceTimersByTime(1); });
  }
  expect(reroute).toHaveBeenCalledTimes(1);
  expect(speak).not.toHaveBeenCalled();
  view.unmount();
});


test('blur stops the watch, stationary refresh, speech and haptics; focus resumes', async () => {
  const fix = { coords: { latitude: 0, longitude: 0.00075, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject;
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(fix);
  const reroute = jest.fn();
  const view = renderHook(({ focused }: { focused: boolean }) => useEvacuationGuidance(response, reroute, focused), { initialProps: { focused: true } });
  await act(async () => {});
  const oldCallback = mockFix;
  view.rerender({ focused: false });
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(stopSpeaking).toHaveBeenCalledTimes(1);
  jest.mocked(speak).mockClear();
  jest.mocked(Haptics.impactAsync).mockClear();
  jest.mocked(Haptics.notificationAsync).mockClear();
  act(() => { oldCallback(fix); jest.advanceTimersByTime(30_000); });
  expect(view.result.current.position).toBeNull();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  expect(reroute).not.toHaveBeenCalled();
  view.rerender({ focused: true });
  await act(async () => {});
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
  act(() => mockFix({ ...fix, timestamp: Date.now() }));
  act(() => jest.advanceTimersByTime(1));
  expect(speak).toHaveBeenCalled();
  expect(Haptics.impactAsync).toHaveBeenCalled();
  view.unmount();
});

test('a stationary walker gets a fresh fix every ten seconds', async () => {
  jest.mocked(Location.getCurrentPositionAsync).mockImplementation(async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject));
  const view = renderHook(() => useEvacuationGuidance(response, jest.fn()));
  await act(async () => {});
  for (let index = 1; index <= 4; index += 1) {
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(index);
    expect(view.result.current.position?.observedAt).toBe(new Date(Date.now()).toISOString());
  }
  view.unmount();
});

test.each([false, true])('arrival haptics follow the saved vibration preference (%s)', async enabled => {
  mockVibration = enabled;
  const view = renderHook(() => useEvacuationGuidance(response, jest.fn()));
  await act(async () => {});
  act(() => mockFix({ coords: { latitude: 0, longitude: 0.00075, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject));
  act(() => jest.advanceTimersByTime(1));
  act(() => mockFix({ coords: { latitude: 0, longitude: 0.00095, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject));
  act(() => jest.advanceTimersByTime(1));
  expect(view.result.current.arrived).toBe(true);
  expect(speak).toHaveBeenCalledWith("You've arrived.", 'en');
  expect(view.result.current.caption).toBe("You've arrived.");
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(enabled ? 1 : 0);
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(enabled ? 1 : 0);
  view.unmount();
});

test.each([
  [{ entranceLatitude: 0.001, entranceLongitude: 0.001 }, 0, 0.0012, true],
  [{ entranceLatitude: 0.001, entranceLongitude: 0.001 }, 0.001, 0.0012, false],
  [{}, 0, 0.0012, false],
  [{ entranceLatitude: 0.001 }, 0, 0.0012, false],
  [{ entranceLatitude: 0, entranceLongitude: 0.001 }, 0.001, 0.0012, true],
] as const)('reroute suppression uses a complete entrance, otherwise the destination (%j)', async (entrance, latitude, longitude, expected) => {
  const reroute = jest.fn();
  const engine = jest.spyOn(routeGuidance, 'useRouteGuidance');
  const view = renderHook(() => useEvacuationGuidance({ ...response, destination: { ...response.destination!, ...entrance } }, reroute));
  await act(async () => {});
  act(() => mockFix({ coords: { latitude, longitude, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject));
  act(() => engine.mock.calls.at(-1)![0].reroute());
  expect(reroute).toHaveBeenCalledTimes(expected ? 1 : 0);
  if (expected) expect(reroute).toHaveBeenCalledWith(view.result.current.position);
  view.unmount();
});
