import { coordinateRoute, OfflineRoutingEngine } from './routing';
import { fixtureManifest } from './test-fixture';

test('explicit offline-only operations never contact online service', async () => {
  const online = jest.fn();
  const offline = jest.fn().mockResolvedValue('offline');
  expect(await coordinateRoute({ offlineOnly: true, online, offline })).toBe('offline');
  expect(online).not.toHaveBeenCalled();
});
test('actual network failure selects fallback but auth failure does not', async () => {
  const offline = jest.fn().mockResolvedValue('unavailable');
  expect(await coordinateRoute({ offlineOnly: false, online: () => Promise.reject({ kind: 'network' }), offline })).toBe('unavailable');
  offline.mockClear();
  await expect(coordinateRoute({ offlineOnly: false, online: () => Promise.reject({ kind: 'http', status: 403 }), offline })).rejects.toEqual({ kind: 'http', status: 403 });
  expect(offline).not.toHaveBeenCalled();
});
test('unverified engine returns unavailable, never a cached or safe route', async () => {
  const result = await OfflineRoutingEngine.route({ origin: { latitude: -6.5, longitude: 106.5 }, destination: { latitude: -6.4, longitude: 106.4 }, costing: 'pedestrian', accessibilityRequirements: ['VISUAL_IMPAIRMENT', 'MOBILITY_LIMITATION'] }, fixtureManifest());
  expect(result.route).toBeNull();
  expect(result.feasibilityStatus).toBe('ROUTING_UNAVAILABLE');
  expect(result.safetyVerified).toBe(false);
  expect(result.evidenceFreshness).toBe('UNKNOWN');
});
test.each([
  [{ latitude: 0, longitude: 0 }, { latitude: -6.5, longitude: 106.5 }, 'ORIGIN_OUTSIDE_COVERAGE'],
  [{ latitude: -6.5, longitude: 106.5 }, { latitude: 0, longitude: 0 }, 'DESTINATION_OUTSIDE_COVERAGE'],
])('reports coverage errors explicitly', async (origin, destination, reason) => {
  const result = await OfflineRoutingEngine.route({ origin, destination, costing: 'pedestrian', accessibilityRequirements: [] }, fixtureManifest());
  expect(result.warnings).toContain(reason);
});
