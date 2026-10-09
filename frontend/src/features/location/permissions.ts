import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

export type PermissionResult = 'granted' | 'denied' | 'blocked';
const result = (permission: { granted: boolean; canAskAgain: boolean }): PermissionResult => permission.granted ? 'granted' : permission.canAskAgain === false ? 'blocked' : 'denied';
export const ensureForeground = async (): Promise<PermissionResult> => result(await Location.requestForegroundPermissionsAsync());
export const ensureBackground = async (): Promise<PermissionResult> => result(await Location.requestBackgroundPermissionsAsync());
export const ensureNotifications = async (): Promise<PermissionResult> => result(await Notifications.requestPermissionsAsync());
export const isPrecise = (accuracyM: number | null) => accuracyM !== null && accuracyM <= 100;
