export { distanceM } from './navigation';

export type BeaconRole = 1 | 2;
export type Beacon = { role: BeaconRole; beaconId: number; latitude: number | null; longitude: number | null; accuracy: number | null };
export const BEACON_SERVICE_UUID = 'E8A00001-5D32-4F47-A5C1-9D7E2B3C1000';
export const BEACON_CHARACTERISTIC_UUID = 'E8A00002-5D32-4F47-A5C1-9D7E2B3C1000';
export const BEACON_COMPANY_ID = 0xffff;
const NO_FIX = 0x7fffffff;

export function encodeBeacon(beacon: Beacon): number[] {
  const { role, beaconId, latitude, longitude, accuracy } = beacon;
  if ((role !== 1 && role !== 2) || !Number.isInteger(beaconId) || beaconId < 1 || beaconId > 0xffffffff) throw new Error('Invalid beacon identity');
  const noFix = latitude === null && longitude === null;
  if (!noFix && (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) throw new Error('Invalid beacon coordinates');
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) throw new Error('Invalid beacon accuracy');
  const bytes = new Uint8Array(15);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0xea;
  bytes[1] = 0x10 | role;
  view.setUint32(2, beaconId, true);
  view.setInt32(6, noFix ? NO_FIX : Math.round(latitude! * 1e7), true);
  view.setInt32(10, noFix ? NO_FIX : Math.round(longitude! * 1e7), true);
  bytes[14] = accuracy === null ? 255 : Math.min(255, Math.ceil(accuracy));
  return Array.from(bytes);
}

export function decodeBeacon(input: readonly number[] | Uint8Array): Beacon | null {
  if (input.length !== 15 || Array.from(input).some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  const bytes = Uint8Array.from(input);
  if (bytes[0] !== 0xea || bytes[1] >> 4 !== 1 || (bytes[1] & 15) < 1 || (bytes[1] & 15) > 2) return null;
  const view = new DataView(bytes.buffer);
  if (view.getUint32(2, true) === 0) return null;
  const lat = view.getInt32(6, true);
  const lon = view.getInt32(10, true);
  if (lat !== NO_FIX && (Math.abs(lat) > 900000000 || Math.abs(lon) > 1800000000)) return null;
  return { role: (bytes[1] & 15) as BeaconRole, beaconId: view.getUint32(2, true), latitude: lat === NO_FIX ? null : lat / 1e7, longitude: lat === NO_FIX ? null : lon / 1e7, accuracy: bytes[14] === 255 ? null : bytes[14] };
}

export function proximity(rssi: number, thresholds = { near: -60, medium: -75 }): 'near' | 'medium' | 'far' {
  if (!Number.isFinite(rssi) || rssi >= 0) return 'far';
  return rssi >= thresholds.near ? 'near' : rssi >= thresholds.medium ? 'medium' : 'far';
}

export function bearing(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180;
  const a = from.latitude * radians;
  const b = to.latitude * radians;
  const delta = (to.longitude - from.longitude) * radians;
  return (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / radians + 360) % 360;
}
