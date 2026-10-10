import { verifyManifest, safePath, freshness } from './manifest';
import { fixtureManifest, testKeys, resign } from './test-fixture';
import nacl from 'tweetnacl';
import { hexToBytes } from '@noble/hashes/utils';
import { canonicalize } from 'json-canonicalize';

test('verifies an RFC8785 signature produced by the real Python backend', () => {
  const unsigned = { z: 1.0, a: 'Jakarta / caf?', bbox: [106.7, -6.3, 106.8, -6.2] };
  const signature = 'ee701bcdd51da35232cf04afc5976088aa1f80d09ecc67d7f25ae8cebce55ae847c91512d51e4d9de620ee6bd4d4db7e2e6f0b5ad8762df05008daa46a9a9403';
  expect(nacl.sign.detached.verify(new TextEncoder().encode(canonicalize(unsigned)), hexToBytes(signature), hexToBytes(testKeys['fixture-key']))).toBe(true);
});

test('accepts a signed manifest with explicitly unavailable routing', () => {
  expect(verifyManifest(fixtureManifest(), testKeys).capabilities.nativeRouting).toBe(false);
});
test('rejects tampering and unpinned keys', () => {
  const manifest = fixtureManifest();
  manifest.capabilities.nativeRouting = true;
  expect(() => verifyManifest(manifest, testKeys)).toThrow('INVALID_SIGNATURE');
  expect(() => verifyManifest(fixtureManifest(), {})).toThrow('UNTRUSTED_PACKAGE');
});
test.each(['../a', '/a', 'map/../a', 'map//a', 'C:/a', 'map/a\\b', './a'])('rejects path traversal %s', path => {
  expect(safePath(path)).toBe(false);
});
test('rejects incompatible versions even with a valid signature', () => {
  const manifest = fixtureManifest();
  manifest.routingEngineVersion = 'other';
  expect(() => verifyManifest(resign(manifest), testKeys)).toThrow('INCOMPATIBLE_PACKAGE');
});
test('rejects duplicate assets and dishonest sizes', () => {
  const manifest = fixtureManifest();
  manifest.assets.push(manifest.assets[0]);
  expect(() => verifyManifest(resign(manifest), testKeys)).toThrow('INVALID_ASSET');
  const size = fixtureManifest();
  size.packageSizeBytes++;
  expect(() => verifyManifest(resign(size), testKeys)).toThrow('INVALID_PACKAGE_SIZE');
});
test('missing expiry remains unknown, distinct from current evidence and package expiry', () => {
  const manifest = fixtureManifest();
  expect(freshness(manifest, Date.parse('2026-02-01'))).toBe('UNKNOWN');
  manifest.hazardEvidenceValidUntil = '2026-03-01T00:00:00Z';
  expect(freshness(manifest, Date.parse('2026-02-01'))).toBe('CURRENT_SNAPSHOT');
  expect(freshness(manifest, Date.parse('2026-04-01'))).toBe('STALE');
  expect(freshness(manifest, Date.parse('2100-01-01'))).toBe('EXPIRED');
});
