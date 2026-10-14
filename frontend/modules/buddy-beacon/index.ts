import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

export type BeaconStatus = 'idle' | 'starting' | 'scanning' | 'off' | 'unauthorized' | 'unavailable' | 'error';
export type BeaconState = { status: BeaconStatus; scanning: boolean; advertising: boolean; error?: string };
export type BeaconEvent = { deviceId: string; payload: number[] | null; rssi: number };
export type StartOptions = { payload: number[]; advertise: boolean };

type BuddyBeaconNative = {
  start(options: StartOptions): Promise<BeaconState>;
  update(payload: number[]): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<BeaconState>;
  addListener(event: 'onBeacon', listener: (event: BeaconEvent) => void): EventSubscription;
  addListener(event: 'onState', listener: (event: BeaconState) => void): EventSubscription;
};

const native = requireOptionalNativeModule<BuddyBeaconNative>('BuddyBeacon');
const unavailable: BeaconState = { status: 'unavailable', scanning: false, advertising: false };
export const available = native !== null;
export const start = (options: StartOptions) => native?.start(options) ?? Promise.resolve(unavailable);
export const update = (payload: number[]) => native?.update(payload) ?? Promise.resolve();
export const stop = () => native?.stop() ?? Promise.resolve();
export const getState = () => native?.getState() ?? Promise.resolve(unavailable);
export const addBeaconListener = (listener: (event: BeaconEvent) => void): EventSubscription => native?.addListener('onBeacon', listener) ?? { remove() {} };
export const addStateListener = (listener: (event: BeaconState) => void): EventSubscription => native?.addListener('onState', listener) ?? { remove() {} };

export async function requestPermissions(): Promise<boolean> {
  if (!available) return false;
  if (Platform.OS !== 'android') return true;
  const permissions: Permission[] = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];
  if (Number(Platform.Version) >= 31) permissions.push(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  );
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}
