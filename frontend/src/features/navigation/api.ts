import { apiRequest } from '@/features/profile/api';

export type Coordinate = [number, number];
export type Origin = { latitude: number; longitude: number; accuracyM: number | null; observedAt: string };
export type Shelter = { id: string; name: string; latitude: number; longitude: number; status: string; wheelchairAccessible: boolean | null; capacity: number | null; currentOccupancy: number | null; source: string | null; distanceM: number };
export type HazardStatus = 'NO_KNOWN_HAZARD' | 'POTENTIALLY_EXPOSED' | 'EXPOSED' | 'UNKNOWN';
export type AccessibilityStatus = 'COMPATIBLE' | 'POTENTIALLY_INCOMPATIBLE' | 'UNKNOWN';
export type NavigationResponse = {
  routeStatus: 'NOT_REQUIRED' | 'PENDING' | 'READY' | 'UNAVAILABLE';
  destination: { shelterId: string; name: string; latitude: number; longitude: number; source?: string | null } | null;
  route: { distanceM: number; durationSec: number; geometry: unknown; profile: string } | null;
  evaluation: { safetyStatus: HazardStatus; accessibilityStatus: AccessibilityStatus; reasonCodes: string[] } | null;
  selectionReasonCodes: string[];
};

export const DEMO_SOURCE = 'DEMO_FIXTURE';

export function nearbyShelters({ latitude, longitude }: { latitude: number; longitude: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), radiusM: '10000', limit: '10' });
  return apiRequest<Shelter[]>(`/v1/shelters/nearby?${query}`, undefined, { signal });
}

export function requestRoute(body: { userId: string; origin: Origin; destinationShelterId?: string }, token: string, signal?: AbortSignal) {
  return apiRequest<NavigationResponse>('/v1/navigation/routes', token, { method: 'POST', body: JSON.stringify(body), signal });
}

export function toCoordinates(geometry: unknown): Coordinate[] {
  const line = geometry as { type?: unknown; coordinates?: unknown };
  if (line?.type !== 'LineString' || !Array.isArray(line.coordinates) || line.coordinates.length < 2) throw new Error('Route geometry is not a LineString');
  return line.coordinates.map(point => {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw new Error('Route geometry has an invalid coordinate');
    return [point[0], point[1]];
  });
}
