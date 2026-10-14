import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { buddyRequest, type Contact } from './api';
import { decodeBeacon, encodeBeacon } from './beacon-codec';
import { useBeacons } from './use-beacons';
import * as Native from '../../../modules/buddy-beacon';

let mockAvailable = true;
let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockBeacon: (event: Native.BeaconEvent) => void;
let mockPosition: (value: Location.LocationObject) => void;
let mockHeading: (value: { trueHeading: number; magHeading: number }) => void;
const mockRemovePosition = jest.fn();
const mockRemoveHeading = jest.fn();
const mockNetworks: ((value: typeof mockNetwork) => void)[] = [];
const mockApps: ((state: AppStateStatus) => void)[] = [];
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array([10, 0, 0, 0])) }));
jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn(async () => mockNetwork), addEventListener: jest.fn((listener: (value: typeof mockNetwork) => void) => { mockNetworks.push(listener); return () => { const index = mockNetworks.indexOf(listener); if (index >= 0) mockNetworks.splice(index, 1); }; }) } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }), watchPositionAsync: jest.fn(async (_options, callback) => { mockPosition = callback; return { remove: mockRemovePosition }; }), watchHeadingAsync: jest.fn(async callback => { mockHeading = callback; return { remove: mockRemoveHeading }; }) }));
jest.mock('../../../modules/buddy-beacon', () => ({ get available() { return mockAvailable; }, requestPermissions: jest.fn().mockResolvedValue(true), start: jest.fn(async options => ({ status: 'scanning', scanning: true, advertising: options.advertise })), update: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), addBeaconListener: jest.fn(listener => { mockBeacon = listener; return { remove: jest.fn() }; }), addStateListener: jest.fn(() => ({ remove: jest.fn() })) }));

const refresh = jest.fn().mockResolvedValue(undefined);
const defaults = { accountId: 'helper', role: 2 as const, active: true, token: 'token', optedIn: true, refresh };
const flush = async () => { await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); }); };
const heard = (id = 20, role: 1 | 2 = 1) => ({ deviceId: `device-${id}`, rssi: -50, payload: encodeBeacon({ role, beaconId: id, latitude: -6.2, longitude: 106.8, accuracy: 5 }) });
const claims = () => jest.mocked(buddyRequest).mock.calls.filter(([, path]) => path === '/nearby/beacons');

beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-13T00:00:00Z')); jest.clearAllMocks();
  mockAvailable = true; mockNetwork = { isConnected: true, isInternetReachable: true }; mockNetworks.length = 0; mockApps.length = 0;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { mockApps.push(callback); return { remove: jest.fn() }; });
  await AsyncStorage.clear();
  await AsyncStorage.setItem('evacuaid.buddy.beacons.v1:helper', JSON.stringify({ beaconId: 10, contacts: [{ beaconId: 20, name: 'Synthetic Buddy' }] }));
  jest.mocked(buddyRequest).mockImplementation(async (_token, path) => path === '/me/beacon' ? { beaconId: 10 } : []);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(Native.requestPermissions).mockResolvedValue(true);
});
afterEach(async () => { await flush(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('Auto search starts scanning and only advertises opted-in helpers', async () => {
  const view = renderHook(() => useBeacons({ ...defaults, optedIn: false })); await flush();
  expect(Native.start).toHaveBeenCalledWith({ payload: expect.any(Array), advertise: false });
  expect(view.result.current.status).toBe('scanning');
  act(() => mockBeacon(heard())); await flush(); expect(claims()).toHaveLength(0);
  view.unmount(); await flush(); expect(Native.stop).toHaveBeenCalled();
});

test('offline scans resolve cached Buddy names, leave strangers anonymous, and send no claims', async () => {
  mockNetwork = { isConnected: false, isInternetReachable: false };
  const view = renderHook(() => useBeacons(defaults)); await flush();
  act(() => { mockBeacon(heard()); mockBeacon(heard(21)); }); await flush();
  expect(view.result.current.people.map(person => person.name)).toEqual(['Synthetic Buddy', null]);
  expect(view.result.current.offline).toBe(true); expect(claims()).toHaveLength(0);
});

test('claims are throttled to three seconds and refresh a returned offer', async () => {
  jest.mocked(buddyRequest).mockImplementation(async (_token, path) => path === '/me/beacon' ? { beaconId: 10 } : [{ id: 'offer' }]);
  renderHook(() => useBeacons(defaults)); await flush(); act(() => mockBeacon(heard())); await flush();
  expect(claims()).toHaveLength(1); expect(refresh).toHaveBeenCalledWith('offer');
  act(() => mockBeacon(heard(21))); await flush(); expect(claims()).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(2999)); expect(claims()).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(1)); await flush();
  expect(claims()).toHaveLength(2); expect(claims()[1][3]).toEqual({ beaconIds: [21] });
});

test('people expire thirty seconds after the last hearing', async () => {
  const view = renderHook(() => useBeacons(defaults)); await flush(); act(() => mockBeacon(heard()));
  expect(view.result.current.people).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(30000)); expect(view.result.current.people).toHaveLength(0);
});

test('distance includes uncertainty and direction; RSSI updates cannot prolong coordinates', async () => {
  const view = renderHook(() => useBeacons(defaults)); await flush();
  const fix = { timestamp: Date.now(), coords: { latitude: -6.201, longitude: 106.8, accuracy: 5 } } as Location.LocationObject;
  act(() => { mockPosition(fix); mockHeading({ trueHeading: 0, magHeading: 0 }); mockBeacon(heard()); });
  expect(view.result.current.people[0].distance).toBeGreaterThan(100); expect(view.result.current.people[0].uncertainty).toBe(10); expect(view.result.current.people[0].direction).toBeCloseTo(0);
  await act(async () => jest.advanceTimersByTime(20000)); act(() => mockBeacon({ deviceId: 'device-20', payload: null, rssi: -55 }));
  await act(async () => jest.advanceTimersByTime(11000)); act(() => mockPosition({ ...fix, timestamp: Date.now() }));
  expect(view.result.current.people).toHaveLength(1); expect(view.result.current.people[0].distance).toBeNull(); expect(view.result.current.people[0].direction).toBeNull();
});

test('a stale own GPS fix becomes a no-fix broadcast', async () => {
  renderHook(() => useBeacons(defaults)); await flush(); act(() => mockPosition({ timestamp: Date.now(), coords: { latitude: -6.2, longitude: 106.8, accuracy: 5 } } as Location.LocationObject));
  await act(async () => jest.advanceTimersByTime(10000)); await flush(); expect(decodeBeacon(jest.mocked(Native.update).mock.calls.at(-1)![0])?.latitude).toBe(-6.2);
  await act(async () => jest.advanceTimersByTime(30000)); await flush(); expect(decodeBeacon(jest.mocked(Native.update).mock.calls.at(-1)![0])?.latitude).toBeNull();
});

test('backgrounding stops scanning, watches and advertising', async () => {
  const view = renderHook(() => useBeacons(defaults)); await flush();
  act(() => { Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' }); mockApps.forEach(listener => listener('background')); }); await flush();
  expect(view.result.current.status).toBe('idle'); expect(Native.stop).toHaveBeenCalled(); expect(mockRemovePosition).toHaveBeenCalled(); expect(mockRemoveHeading).toHaveBeenCalled();
});

test('a late Bluetooth permission response cannot start after leaving', async () => {
  let finish!: (granted: boolean) => void; jest.mocked(Native.requestPermissions).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = renderHook(({ active }: { active: boolean }) => useBeacons({ ...defaults, active }), { initialProps: { active: true } }); await flush();
  view.rerender({ active: false }); await flush(); await act(async () => finish(true)); await flush();
  expect(Native.start).not.toHaveBeenCalled(); expect(Native.stop).toHaveBeenCalled();
});

test('a missing native module is unavailable without location permission prompts', async () => {
  mockAvailable = false; const view = renderHook(() => useBeacons(defaults)); await flush();
  expect(view.result.current.status).toBe('unavailable'); expect(Native.requestPermissions).not.toHaveBeenCalled(); expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('reconnect upgrades a locally generated beacon ID to its server identity', async () => {
  mockNetwork = { isConnected: false, isInternetReachable: false }; await AsyncStorage.clear();
  const view = renderHook(() => useBeacons(defaults)); await flush(); expect(jest.mocked(buddyRequest)).not.toHaveBeenCalled();
  act(() => mockNetworks.forEach(listener => listener({ isConnected: true, isInternetReachable: true }))); await flush();
  expect(jest.mocked(buddyRequest)).toHaveBeenCalledWith('token', '/me/beacon', 'GET', undefined, expect.any(AbortSignal)); view.unmount();
});

test('initial empty contacts preserve cached names until an authoritative refresh', async () => {
  const view = renderHook(({ ready, contacts }: { ready: boolean; contacts: Contact[] }) => useBeacons({ ...defaults, contactsReady: ready, contacts }), { initialProps: { ready: false, contacts: [] as Contact[] } }); await flush();
  act(() => mockBeacon(heard())); expect(view.result.current.people[0].name).toBe('Synthetic Buddy');
  view.rerender({ ready: true, contacts: [] }); await flush(); expect(view.result.current.people[0].name).toBeNull();
});

test('account switches isolate beacon identities and names', async () => {
  await AsyncStorage.setItem('evacuaid.buddy.beacons.v1:second', JSON.stringify({ beaconId: 11, contacts: [] })); mockNetwork = { isConnected: false, isInternetReachable: false };
  const view = renderHook(({ accountId }: { accountId: string }) => useBeacons({ ...defaults, accountId }), { initialProps: { accountId: 'helper' } }); await flush(); act(() => mockBeacon(heard())); expect(view.result.current.people[0].name).toBe('Synthetic Buddy');
  view.rerender({ accountId: 'second' }); await flush(); act(() => mockBeacon(heard())); expect(view.result.current.people[0].name).toBeNull();
  expect(decodeBeacon(jest.mocked(Native.start).mock.calls.at(-1)![0].payload)?.beaconId).toBe(11);
});

test('Bluetooth permission waits for the location permission response and blur prevents the later request', async () => {
  let finish!: (value: Location.LocationPermissionResponse) => void;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = renderHook(({ active }: { active: boolean }) => useBeacons({ ...defaults, active }), { initialProps: { active: true } }); await flush();
  expect(Native.requestPermissions).not.toHaveBeenCalled();
  view.rerender({ active: false }); await act(async () => { finish({ status: 'granted' } as Location.LocationPermissionResponse); }); await flush();
  expect(Native.requestPermissions).not.toHaveBeenCalled(); expect(Native.start).not.toHaveBeenCalled();
});
