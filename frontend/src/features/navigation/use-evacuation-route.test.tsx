import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useEvacuationRoute } from './use-evacuation-route';
import { nearbyShelters, requestRoute } from './api';

let mockSession: { token: string | null; user: { id: string } | null };
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => mockSession }));
jest.mock('./api', () => ({ ...jest.requireActual('./api'), nearbyShelters: jest.fn(), requestRoute: jest.fn() }));

const location = jest.mocked(Location);
const shelters = [{ id: 's1', name: 'Hall', latitude: -6.27, longitude: 106.82, status: 'OPEN', wheelchairAccessible: null, capacity: null, currentOccupancy: null, source: null, distanceM: 900 }];
const ready = {
  routeStatus: 'READY',
  destination: { shelterId: 's1', name: 'Hall', latitude: -6.27, longitude: 106.82 },
  route: { distanceM: 900, durationSec: 660, geometry: { type: 'LineString', coordinates: [[106.81, -6.26], [106.82, -6.27]] }, profile: 'pedestrian' },
  evaluation: { safetyStatus: 'UNKNOWN', accessibilityStatus: 'UNKNOWN', reasonCodes: [] },
  selectionReasonCodes: [],
};

async function settled() {
  const view = renderHook(() => useEvacuationRoute());
  await waitFor(() => expect(view.result.current.phase).toBe('located'));
  return view;
}

function grant(granted: boolean) {
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted } as Location.LocationPermissionResponse);
  location.requestForegroundPermissionsAsync.mockResolvedValue({ granted } as Location.LocationPermissionResponse);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSession = { token: 't', user: { id: 'u1' } };
  grant(false);
  location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: -6.26, longitude: 106.81, accuracy: 15 }, timestamp: Date.now() } as Location.LocationObject);
  jest.mocked(nearbyShelters).mockResolvedValue(shelters);
});

test('starts waiting for a location and does not prompt on mount', async () => {
  const { result } = renderHook(() => useEvacuationRoute());
  await waitFor(() => expect(location.getForegroundPermissionsAsync).toHaveBeenCalled());
  expect(result.current.phase).toBe('needsLocation');
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('a denied permission ends in the denied phase without calling the API', async () => {
  const { result } = renderHook(() => useEvacuationRoute());
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('denied');
  expect(requestRoute).not.toHaveBeenCalled();
});

test('a ready response exposes the route coordinates and shelters', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValue(ready as never);
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('ready');
  expect(result.current.route?.coordinates).toEqual([[106.81, -6.26], [106.82, -6.27]]);
  expect(result.current.shelters).toEqual(shelters);
  expect(requestRoute).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', origin: expect.objectContaining({ latitude: -6.26, longitude: 106.81, accuracyM: 15 }) }), 't', expect.any(AbortSignal));
});

test('a chosen shelter is sent as the destination', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValue(ready as never);
  const { result } = await settled();
  await act(() => result.current.findRoute('s1'));
  expect(requestRoute).toHaveBeenCalledWith(expect.objectContaining({ destinationShelterId: 's1' }), 't', expect.any(AbortSignal));
});

test('an unavailable route keeps the provider reason', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValue({ ...ready, routeStatus: 'UNAVAILABLE', route: null, evaluation: { safetyStatus: 'UNKNOWN', accessibilityStatus: 'UNKNOWN', reasonCodes: ['ROUTING_PROVIDER_UNAVAILABLE'] } } as never);
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('unavailable');
  expect(result.current.reason).toBe('ROUTING_PROVIDER_UNAVAILABLE');
  expect(result.current.route).toBeNull();
});

test('a network failure surfaces as an error of that kind', async () => {
  grant(true);
  jest.mocked(requestRoute).mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('error');
  expect(result.current.errorKind).toBe('network');
});

test('a missing guest session is reported before any request', async () => {
  grant(true);
  mockSession = { token: null, user: null };
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('error');
  expect(result.current.errorKind).toBe('session');
  expect(requestRoute).not.toHaveBeenCalled();
});

test('an aborted request is ignored rather than shown as an error', async () => {
  grant(true);
  jest.mocked(requestRoute).mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('routing');
  expect(result.current.errorKind).toBeNull();
});

test('a permission that is already granted locates silently and loads shelters', async () => {
  grant(true);
  const { result } = renderHook(() => useEvacuationRoute());
  await waitFor(() => expect(result.current.shelters).toEqual(shelters));
  expect(result.current.phase).toBe('located');
  expect(result.current.origin).toEqual(expect.objectContaining({ latitude: -6.26, longitude: 106.81 }));
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(requestRoute).not.toHaveBeenCalled();
});

test('clearRoute drops the route and returns to located', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValue(ready as never);
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.phase).toBe('ready');
  act(() => result.current.clearRoute());
  expect(result.current.phase).toBe('located');
  expect(result.current.route).toBeNull();
  expect(result.current.origin).not.toBeNull();
});

test('re-routing drops the previous route line before the new result arrives', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValueOnce(ready as never).mockReturnValueOnce(new Promise(() => {}) as never);
  const { result } = await settled();
  await act(() => result.current.findRoute());
  expect(result.current.route).not.toBeNull();
  act(() => { void result.current.findRoute('s2'); });
  expect(result.current.route).toBeNull();
  expect(result.current.phase).toBe('routing');
});

test('a route request routes on arrival and again only when the request changes', async () => {
  grant(true);
  jest.mocked(requestRoute).mockResolvedValue(ready as never);
  const view = renderHook(({ request }: { request?: string }) => useEvacuationRoute(request), { initialProps: { request: 'first' } });
  await waitFor(() => expect(view.result.current.phase).toBe('ready'));
  expect(requestRoute).toHaveBeenCalledTimes(1);
  view.rerender({ request: 'first' });
  await act(async () => {});
  expect(requestRoute).toHaveBeenCalledTimes(1);
  view.rerender({ request: 'second' });
  await waitFor(() => expect(requestRoute).toHaveBeenCalledTimes(2));
});
