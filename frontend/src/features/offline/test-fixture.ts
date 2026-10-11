import nacl from 'tweetnacl';
import { canonicalize } from 'json-canonicalize';
import { bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import type { OfflineManifest } from './manifest';

// Deterministic test key and tiny fixtures; never used by production.
export const testKey = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
export const testKeys = { 'fixture-key': bytesToHex(testKey.publicKey) };
export function fixtureManifest(revision = 'a'): OfflineManifest {
  const unsigned = {
    packageId: revision.repeat(64), schemaVersion: 1,
    regionId: '11111111-1111-4111-8111-111111111111', regionName: 'Public test fixture',
    bbox: [106, -7, 107, -6], generatedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    mapDataVersion: 'map-fixture', routingEngine: 'valhalla', routingEngineVersion: '3.9.0',
    graphVersion: 'fixture-only', graphCompatibility: 'UNVERIFIED',
    hazardSnapshotAt: '2026-01-01T00:00:00Z', hazardEvidenceValidUntil: null,
    sourceProvenance: { mapAttribution: 'Public test fixture' },
    capabilities: { offlineMap: true, nativeRouting: false, hazardEvaluation: false, cachedRoutes: false },
    warnings: ['SAFETY_NOT_VERIFIED'],
    assets: ['map/streets.geojson', 'map/boundary.geojson', 'map/coverage.geojson', 'hazards/evidence.json', 'shelters/shelters.json', 'cached-routes/routes.json'].map(path => ({
      path, kind: path.split('/')[0], sizeBytes: 2, sha256: bytesToHex(sha256(new TextEncoder().encode('{}'))),
    })),
  };
  const document = { ...unsigned, packageSizeBytes: unsigned.assets.length * 2, contentChecksums: Object.fromEntries(unsigned.assets.map(asset => [asset.path, asset.sha256])) };
  return { ...document, packageSignature: { keyId: 'fixture-key', algorithm: 'Ed25519', value: bytesToHex(nacl.sign.detached(new TextEncoder().encode(canonicalize(document)), testKey.secretKey)) } } as OfflineManifest;
}
export function resign(manifest: OfflineManifest) {
  const { packageSignature: _signature, ...unsigned } = manifest;
  manifest.packageSignature.value = bytesToHex(nacl.sign.detached(new TextEncoder().encode(canonicalize(unsigned)), testKey.secretKey));
  return manifest;
}
