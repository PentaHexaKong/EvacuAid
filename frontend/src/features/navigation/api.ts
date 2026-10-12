import type { Maneuver } from '@/features/buddy/api';
import { apiRequest } from '@/features/profile/api';
import { coordinateRoute } from '@/features/offline/routing';

export type Coordinate = [number, number];
export type Origin = { latitude: number; longitude: number; accuracyM: number | null; observedAt: string };
export type Shelter = { entranceLatitude?: number | null; entranceLongitude?: number | null; entranceNote?: string | null; id: string; name: string; latitude: number; longitude: number; status: string; wheelchairAccessible: boolean | null; capacity: number | null; source: string | null; distanceM: number };
export type HazardStatus = 'NO_KNOWN_HAZARD' | 'POTENTIALLY_EXPOSED' | 'EXPOSED' | 'UNKNOWN';
export type AccessibilityStatus = 'COMPATIBLE' | 'POTENTIALLY_INCOMPATIBLE' | 'UNKNOWN';
export type NavigationResponse = {
  routeStatus: 'NOT_REQUIRED' | 'PENDING' | 'READY' | 'UNAVAILABLE';
  destination: { entranceLatitude?: number | null; entranceLongitude?: number | null; entranceNote?: string | null; shelterId: string; name: string; latitude: number; longitude: number; source?: string | null } | null;
  route: { distanceM: number; durationSec: number; geometry: unknown; profile: string; maneuvers: Maneuver[] } | null;
  evaluation: { safetyStatus: HazardStatus; accessibilityStatus: AccessibilityStatus; reasonCodes: string[] } | null;
  selectionReasonCodes: string[];
  routingMode?: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  evidenceFreshness?: string;
  dataCoverage?: number[] | null;
  graphVersion?: string | null;
  packageVersion?: string | null;
  warnings?: string[];
  feasibilityStatus?: string;
  safetyVerified?: false;
};

export const DEMO_SOURCE = 'DEMO_FIXTURE';

export function nearbyShelters({ latitude, longitude }: { latitude: number; longitude: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), radiusM: '10000', limit: '10' });
  return apiRequest<Shelter[]>(`/v1/shelters/nearby?${query}`, undefined, { signal });
}

export function requestRoute(body: { userId: string; origin: Origin; destinationShelterId?: string; profile?: 'WALKING' | 'WHEELCHAIR' }, token: string, signal?: AbortSignal, options: { offlineOnly?: boolean } = {}) {
  return coordinateRoute<NavigationResponse>({
    offlineOnly: Boolean(options.offlineOnly),
    online: async () => {
      const response = await apiRequest<NavigationResponse>('/v1/navigation/routes', token, { method: 'POST', body: JSON.stringify(body), signal });
      return { ...response, routingMode: 'ONLINE', evidenceFreshness: 'UNKNOWN',
        dataCoverage: null, graphVersion: null, packageVersion: null, safetyVerified: false,
        warnings: ['SAFETY_NOT_VERIFIED', 'EVIDENCE_FRESHNESS_NOT_EXPOSED'],
        feasibilityStatus: response.routeStatus === 'READY' ? 'FEASIBLE_AGAINST_SERVER_POLICY' : 'SERVER_RESULT' };
    },
    offline: async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { installedPackages } = await import('@/features/offline/package-manager');
      const { covers, freshness } = await import('@/features/offline/manifest');
      const installed = (await installedPackages()).find(item => covers(item.manifest, body.origin));
      const reasons = [installed ? 'NATIVE_ENGINE_NOT_VERIFIED' : 'MISSING_PACKAGE', 'SAFETY_NOT_VERIFIED'];
      return { routeStatus: 'UNAVAILABLE', destination: null, route: null,
        evaluation: { safetyStatus: 'UNKNOWN', accessibilityStatus: 'UNKNOWN', reasonCodes: reasons },
        selectionReasonCodes: reasons, routingMode: options.offlineOnly ? 'OFFLINE' : 'DEGRADED',
        evidenceFreshness: installed ? freshness(installed.manifest) : 'UNKNOWN',
        dataCoverage: installed?.manifest.bbox ?? null, graphVersion: installed?.manifest.graphVersion ?? null,
        packageVersion: installed?.manifest.packageId ?? null, warnings: reasons,
        feasibilityStatus: 'ROUTING_UNAVAILABLE', safetyVerified: false };
    },
  });
}

export function toCoordinates(geometry: unknown): Coordinate[] {
  const line = geometry as { type?: unknown; coordinates?: unknown };
  if (line?.type !== 'LineString' || !Array.isArray(line.coordinates) || line.coordinates.length < 2) throw new Error('Route geometry is not a LineString');
  return line.coordinates.map(point => {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw new Error('Route geometry has an invalid coordinate');
    return [point[0], point[1]];
  });
}
