import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { apiRequest } from '@/features/profile/api';
import { ensureBackground } from './permissions';
import { alertAreaRunning, askAlwaysAndStart, startAlertArea, stopAlertArea } from './alert-area';

jest.mock('expo-location', () => ({ getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }), hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true), startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined), stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined), Accuracy: { Low: 2 }, ActivityType: { Other: 1 } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn().mockResolvedValue(undefined), deleteItemAsync: jest.fn().mockResolvedValue(undefined), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-unlock' }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: jest.fn(() => false), defineTask: jest.fn() }));
jest.mock('@/features/profile/api', () => ({ apiRequest: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./permissions', () => ({ ensureBackground: jest.fn().mockResolvedValue('granted') }));

const task = jest.mocked(TaskManager.defineTask).mock.calls.find(([name]) => name === 'evacuaid-alert-area')![1];
const fix = (latitude: number, timestamp: number) => ({ coords: { latitude, longitude: 2, accuracy: 80 }, timestamp });
const update = { data: { locations: [fix(1, 1000), fix(3, 2000)] }, error: null, executionInfo: { eventId: 'test', taskName: 'evacuaid-alert-area' } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ token: 'guest', userId: 'user' }));
});

test('the area task posts only the last fix using the profile API contract', async () => {
  await task(update);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(apiRequest).toHaveBeenCalledWith('/v1/users/user/location', 'guest', { method: 'PUT', body: JSON.stringify({ latitude: 3, longitude: 2, accuracy_m: 80, observed_at: '1970-01-01T00:00:02.000Z' }) });
});

test.each([401, 403])('%s stops the area task and clears its credentials', async status => {
  jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('rejected'), { status }));
  await task(update);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('evacuaid.alert-area-credentials.v1');
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('evacuaid-alert-area');
});

test('stopAlertArea never stops or clears the Buddy task', async () => {
  await stopAlertArea();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('evacuaid-alert-area');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('evacuaid.alert-area-credentials.v1');
});

test('start stores credentials and uses the requested coarse movement options', async () => {
  await startAlertArea('guest', 'user');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('evacuaid.alert-area-credentials.v1', JSON.stringify({ token: 'guest', userId: 'user' }), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith('evacuaid-alert-area', { accuracy: Location.Accuracy.Low, distanceInterval: 500, deferredUpdatesDistance: 500, pausesUpdatesAutomatically: true, activityType: Location.ActivityType.Other, showsBackgroundLocationIndicator: false });
  await expect(alertAreaRunning()).resolves.toBe(true);
});

test('blocked Always permission never starts the task', async () => {
  jest.mocked(ensureBackground).mockResolvedValueOnce('blocked');
  await expect(askAlwaysAndStart('guest', 'user')).resolves.toBe('blocked');
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

test('transient failures leave the area task running', async () => {
  jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 500 }));
  await task(update);
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});


test('denied background permission never stores credentials or starts tracking', async () => {
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as Location.LocationPermissionResponse);
  await expect(startAlertArea('guest', 'user')).rejects.toThrow('permission');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

test('Android does not start background tracking without a foreground service', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    await expect(startAlertArea('guest', 'user')).rejects.toThrow('Android');
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  } finally { platform.restore(); }
});
