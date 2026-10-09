import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as routeGuidance from '@/features/buddy-pilot/use-route-guidance';
import { speak } from '@/features/feedback/speech';
import { useEvacuationGuidance } from './use-evacuation-guidance';
import type { NavigationResponse } from './api';

let mockSoundFree = false;
let mockListen = true;
const mockRemove = jest.fn();
let mockFix: (fix: Location.LocationObject) => void;
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, watchPositionAsync: jest.fn((_options, callback) => { mockFix = callback; return Promise.resolve({ remove: mockRemove }); }) }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ listen: mockListen, soundFree: mockSoundFree }) }));
jest.mock('@/features/feedback/speech', () => ({ speak: jest.fn().mockResolvedValue(undefined), stopSpeaking: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
const response: NavigationResponse = { routeStatus: 'READY', destination: { shelterId: 'hall', name: 'Hall', latitude: 0, longitude: 0.001, entranceNote: 'East door' }, route: { distanceM: 111, durationSec: 120, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] }, profile: 'PEDESTRIAN', maneuvers: [{ instruction: 'Walk east', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 111, durationSec: 120, type: 1 }] }, evaluation: null, selectionReasonCodes: [] };

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); mockSoundFree = false; mockListen = true; });
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
