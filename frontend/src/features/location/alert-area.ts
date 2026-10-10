import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { apiRequest, type ApiError } from '@/features/profile/api';
import { authSession } from '@/features/profile/auth-session';
import { ensureBackground, type PermissionResult } from './permissions';

const TASK = 'evacuaid-alert-area';
const CREDENTIALS_KEY = 'evacuaid.alert-area-credentials.v1';
type Credentials = { userId: string };

export const alertAreaRunning = () => Location.hasStartedLocationUpdatesAsync(TASK);

export async function stopAlertArea() {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  if (await alertAreaRunning()) await Location.stopLocationUpdatesAsync(TASK);
}

if (!TaskManager.isTaskDefined(TASK)) TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations.length) return;
  const saved = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!saved) return;
  try {
    const { userId } = JSON.parse(saved) as Credentials;
    const account = await authSession.restore();
    if (!account || account.user.id !== userId) { await stopAlertArea(); return; }
    const token = await authSession.current(account.access_token);
    const value = data.locations[data.locations.length - 1];
    await apiRequest(`/v1/users/${userId}/location`, token, { method: 'PUT', body: JSON.stringify({ latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy_m: value.coords.accuracy, observed_at: new Date(value.timestamp).toISOString() }) });
  } catch (cause) {
    if ([401, 403].includes((cause as ApiError).status ?? 0)) await stopAlertArea();
  }
});

export async function startAlertArea(token: string, userId: string) {
  const permission = await Location.getBackgroundPermissionsAsync();
  if (!permission.granted) throw new Error('Background location permission is required.');
  if (Platform.OS === 'android') throw new Error('Background area updates are not available on Android yet.');
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify({ userId }), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  try {
    await Location.startLocationUpdatesAsync(TASK, { accuracy: Location.Accuracy.Low, distanceInterval: 500, deferredUpdatesDistance: 500, pausesUpdatesAutomatically: true, activityType: Location.ActivityType.Other, showsBackgroundLocationIndicator: false });
  } catch (cause) { await stopAlertArea(); throw cause; }
}

export async function askAlwaysAndStart(token: string, userId: string): Promise<PermissionResult> {
  const permission = await ensureBackground();
  if (permission === 'granted') await startAlertArea(token, userId);
  return permission;
}
