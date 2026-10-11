import nacl from 'tweetnacl';
import { canonicalize } from 'json-canonicalize';
import { hexToBytes } from '@noble/hashes/utils';

export type OfflineAsset = { path: string; sha256: string; sizeBytes: number; kind: string };
export type OfflineManifest = {
  packageId: string; schemaVersion: number; regionId: string; regionName: string;
  bbox: [number, number, number, number]; generatedAt: string; expiresAt: string;
  mapDataVersion: string; routingEngine: string; routingEngineVersion: string | null;
  graphVersion: string; graphCompatibility: string; hazardSnapshotAt: string;
  hazardEvidenceValidUntil: string | null; packageSizeBytes: number;
  contentChecksums: Record<string, string>; assets: OfflineAsset[];
  packageSignature: { algorithm: string; keyId: string; value: string };
  sourceProvenance: { mapAttribution: string; [key: string]: unknown };
  capabilities: { offlineMap: boolean; nativeRouting: boolean; hazardEvaluation: boolean; cachedRoutes: boolean; [key: string]: boolean };
  warnings: string[];
};

export function safePath(path: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') &&
    path.split('/').every(part => part !== '..' && part !== '.' && part.length > 0);
}

// The public key is pinned in the application build, never fetched from a package server.
export function trustedKeys(): Record<string, string> {
  return { [process.env.EXPO_PUBLIC_OFFLINE_KEY_ID || 'offline-v1']: process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY || '' };
}

export function verifyManifest(value: unknown, keys = trustedKeys()): OfflineManifest {
  if (!value || typeof value !== 'object') throw new Error('INVALID_MANIFEST');
  const manifest = value as OfflineManifest;
  const signature = manifest.packageSignature;
  const publicKey = signature && keys[signature.keyId];
  if (!signature || signature.algorithm !== 'Ed25519' || !publicKey || !/^[a-f0-9]{64}$/.test(publicKey) || !/^[a-f0-9]{128}$/.test(signature.value)) throw new Error('UNTRUSTED_PACKAGE');
  const { packageSignature: _signature, ...unsigned } = manifest;
  if (!nacl.sign.detached.verify(new TextEncoder().encode(canonicalize(unsigned)), hexToBytes(signature.value), hexToBytes(publicKey))) throw new Error('INVALID_SIGNATURE');
  if (manifest.schemaVersion !== 1 || manifest.routingEngine !== 'valhalla' || !['3.9.0', null].includes(manifest.routingEngineVersion)) throw new Error('INCOMPATIBLE_PACKAGE');
  if (!/^[a-f0-9]{64}$/.test(manifest.packageId) || !/^[a-f0-9-]{36}$/.test(manifest.regionId)) throw new Error('INVALID_PACKAGE_ID');
  const bbox = manifest.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite) || !(bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 && bbox[0] < bbox[2] && bbox[1] < bbox[3])) throw new Error('INVALID_COVERAGE');
  const generated = Date.parse(manifest.generatedAt), expiry = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(generated) || !Number.isFinite(expiry) || generated >= expiry) throw new Error('INVALID_EXPIRY');
  if (!Array.isArray(manifest.assets) || manifest.assets.length > 20000) throw new Error('INVALID_ASSETS');
  let size = 0;
  const paths = new Set<string>();
  for (const asset of manifest.assets) {
    if (!safePath(asset.path) || paths.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0 || !['map', 'routing', 'hazards', 'shelters', 'cached-routes'].includes(asset.kind) || !asset.path.startsWith(asset.kind + '/') || manifest.contentChecksums?.[asset.path] !== asset.sha256) throw new Error('INVALID_ASSET');
    if (asset.kind !== 'routing' && asset.sizeBytes > 16 * 1024 * 1024) throw new Error('DISPLAY_ASSET_TOO_LARGE');
    paths.add(asset.path); size += asset.sizeBytes;
  }
  if (!Number.isSafeInteger(size) || size !== manifest.packageSizeBytes || Object.keys(manifest.contentChecksums).length !== paths.size) throw new Error('INVALID_PACKAGE_SIZE');
  for (const required of ['map/streets.geojson', 'map/boundary.geojson', 'map/coverage.geojson', 'hazards/evidence.json', 'shelters/shelters.json', 'cached-routes/routes.json']) if (!paths.has(required)) throw new Error('MISSING_ASSET');
  return manifest;
}

export function freshness(manifest: OfflineManifest, now = Date.now()) {
  if (now >= Date.parse(manifest.expiresAt)) return 'EXPIRED';
  if (!manifest.hazardEvidenceValidUntil || !Number.isFinite(Date.parse(manifest.hazardEvidenceValidUntil))) return 'UNKNOWN';
  return now >= Date.parse(manifest.hazardEvidenceValidUntil) ? 'STALE' : 'CURRENT_SNAPSHOT';
}

export function covers(manifest: OfflineManifest, point: { latitude: number; longitude: number }) {
  const [west, south, east, north] = manifest.bbox;
  return point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north;
}
