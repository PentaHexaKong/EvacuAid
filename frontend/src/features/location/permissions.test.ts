import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { ensureBackground, ensureForeground, ensureNotifications, isPrecise } from './permissions';

jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: jest.fn() }));

test.each([
  ['granted', { granted: true, canAskAgain: false }],
  ['denied', { granted: false, canAskAgain: true }],
  ['blocked', { granted: false, canAskAgain: false }],
] as const)('permission helpers return %s', async (expected, permission) => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(permission as Location.LocationPermissionResponse);
  jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue(permission as Location.LocationPermissionResponse);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permission as Notifications.NotificationPermissionsStatus);
  await expect(ensureForeground()).resolves.toBe(expected);
  await expect(ensureBackground()).resolves.toBe(expected);
  await expect(ensureNotifications()).resolves.toBe(expected);
});

test.each([[99, true], [100, true], [101, false], [null, false]])('precision at %s m is %s', (accuracy, expected) => {
  expect(isPrecise(accuracy as number | null)).toBe(expected);
});
