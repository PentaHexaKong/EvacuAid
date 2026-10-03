import type { HazardItem, HazardType } from './api';

export type ZoneSource = Pick<HazardItem, 'id' | 'type' | 'latitude' | 'longitude' | 'magnitude' | 'reportCount'>;
export type ZoneFeature = { type: 'Feature'; id: string; properties: { hazard: HazardType; ring: 'core' | 'outer' }; geometry: { type: 'Polygon'; coordinates: [number, number][][] } };
export type ZoneCollection = { type: 'FeatureCollection'; features: ZoneFeature[] };

const KM_PER_DEGREE = 111.32;
const VERTICES = 64;
// Hazards whose outer ring stays this far from the reference point are left off the map.
const NEARBY_KM = 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Estimated radii in km, core first. These are rough indications for the map, never official impact zones.
export function zoneRadii({ type, magnitude, reportCount }: ZoneSource): number[] {
  if (type === 'earthquake') {
    if (magnitude == null) return [];
    // ponytail: magnitude-only felt-distance rule of thumb (M5 ≈ 5 km strong, M7 ≈ 50 km); depth and soil ignored, swap in BMKG shakemaps when the backend has them.
    const core = clamp(10 ** (0.5 * magnitude - 1.8), 1, 60);
    return [core, clamp(core * 2.5, 3, 150)];
  }
  if (type === 'volcano') return [3, 7];
  if (type === 'flood') return [clamp(0.5 + 0.25 * Math.sqrt(reportCount ?? 1), 0.5, 3)];
  if (type === 'haze') return [10];
  if (type === 'wind') return [5];
  return [1];
}

export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function circle(longitude: number, latitude: number, km: number): [number, number][] {
  const ring: [number, number][] = [];
  const dLat = km / KM_PER_DEGREE;
  const dLng = km / (KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  for (let step = 0; step < VERTICES; step += 1) {
    const angle = (step / VERTICES) * 2 * Math.PI;
    ring.push([longitude + dLng * Math.cos(angle), latitude + dLat * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

// Placed hazards near `near` (all placed hazards when it is null), as their estimated zones and the items kept.
export function hazardZones(items: ZoneSource[], near: { latitude: number; longitude: number } | null) {
  const kept: ZoneSource[] = [];
  const features: ZoneFeature[] = [];
  for (const item of items) {
    if (item.latitude == null || item.longitude == null) continue;
    const radii = zoneRadii(item);
    if (!radii.length) continue;
    if (near && distanceKm(near, { latitude: item.latitude, longitude: item.longitude }) - radii[radii.length - 1] > NEARBY_KM) continue;
    kept.push(item);
    // Outer rings first so the core draws on top of them.
    [...radii].reverse().forEach((km, index) => features.push({
      type: 'Feature',
      id: `${item.id}-${index}`,
      properties: { hazard: item.type, ring: index === radii.length - 1 ? 'core' : 'outer' },
      geometry: { type: 'Polygon', coordinates: [circle(item.longitude!, item.latitude!, km)] },
    }));
  }
  return { zones: { type: 'FeatureCollection', features } as ZoneCollection, items: kept };
}
