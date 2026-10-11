import type { OfflineManifest } from './manifest';
import { covers, freshness } from './manifest';

export type OfflineRouteStatus = 'NO_FEASIBLE_ROUTE' | 'INSUFFICIENT_EVIDENCE' | 'ROUTING_UNAVAILABLE';
export type OfflineRouteRequest = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  costing: 'pedestrian'; accessibilityRequirements: string[];
};

// The mandatory native spike is blocked. Do not expose an unverified native module
// or substitute cached geometry for a new calculation.
export const OfflineRoutingEngine = {
  async initialize(_packagePath: string) { return this.getStatus(); },
  async getStatus() { return { available: false, reason: 'NATIVE_ENGINE_NOT_VERIFIED', android: 'BLOCKED', ios: 'UNVERIFIED' } as const; },
  async release() {},
  async route(request: OfflineRouteRequest, manifest?: OfflineManifest) {
    let reason = !manifest ? 'MISSING_PACKAGE' : 'NATIVE_ENGINE_NOT_VERIFIED';
    if (manifest && !covers(manifest, request.origin)) reason = 'ORIGIN_OUTSIDE_COVERAGE';
    else if (manifest && !covers(manifest, request.destination)) reason = 'DESTINATION_OUTSIDE_COVERAGE';
    return {
      route: null, routingMode: 'OFFLINE' as const, feasibilityStatus: 'ROUTING_UNAVAILABLE' as OfflineRouteStatus,
      evidenceFreshness: manifest ? freshness(manifest) : 'UNKNOWN',
      dataCoverage: manifest?.bbox ?? null, graphVersion: manifest?.graphVersion ?? null,
      packageVersion: manifest?.packageId ?? null, safetyVerified: false,
      warnings: [reason, 'SAFETY_NOT_VERIFIED', ...(manifest && freshness(manifest) !== 'CURRENT_SNAPSHOT' ? ['EVIDENCE_MAY_HAVE_CHANGED'] : [])],
    };
  },
};

export async function coordinateRoute<T>({
  offlineOnly, online, offline,
}: { offlineOnly: boolean; online: () => Promise<T>; offline: () => Promise<T> }): Promise<T> {
  if (offlineOnly) return offline();
  try { return await online(); }
  catch (error) {
    // Actual request failure, not connectivity alone. Authentication and policy
    // denials are never reinterpreted as a reason to bypass the server.
    if ((error as { kind?: string }).kind !== 'network') throw error;
    return offline();
  }
}
