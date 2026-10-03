import { distanceKm, hazardZones, zoneRadii, type ZoneSource } from './zones';

const base: ZoneSource = { id: 'a', type: 'flood', latitude: -6.27, longitude: 106.81, magnitude: null, reportCount: 4 };
const jakarta = { latitude: -6.2675, longitude: 106.8095 };

test('radii follow the hazard type and stay inside their clamps', () => {
  expect(zoneRadii({ ...base, type: 'volcano' })).toEqual([3, 7]);
  expect(zoneRadii({ ...base, type: 'earthquake', magnitude: null })).toEqual([]);
  const [core, outer] = zoneRadii({ ...base, type: 'earthquake', magnitude: 6 });
  expect(core).toBeCloseTo(15.85, 1);
  expect(outer).toBeCloseTo(core * 2.5, 5);
  expect(zoneRadii({ ...base, type: 'earthquake', magnitude: 9.5 })).toEqual([60, 150]);
  expect(zoneRadii({ ...base, type: 'earthquake', magnitude: 1 })).toEqual([1, 3]);
  expect(zoneRadii({ ...base, reportCount: 10_000 })).toEqual([3]);
});

test('each ring is a closed polygon at the stated radius, outer ring first', () => {
  const { zones } = hazardZones([{ ...base, type: 'volcano' }], null);
  expect(zones.features.map(feature => feature.properties.ring)).toEqual(['outer', 'core']);
  for (const [feature, km] of [[zones.features[0], 7], [zones.features[1], 3]] as const) {
    const ring = feature.geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const [longitude, latitude] of ring) expect(distanceKm({ latitude: base.latitude!, longitude: base.longitude! }, { latitude, longitude })).toBeCloseTo(km, 1);
  }
});

test('unplaced, unsized and far-away hazards are left off the map', () => {
  const items: ZoneSource[] = [
    base,
    { ...base, id: 'nowhere', latitude: null },
    { ...base, id: 'unsized', type: 'earthquake', magnitude: null },
    { ...base, id: 'bali', type: 'volcano', latitude: -8.34, longitude: 115.5 },
  ];
  expect(hazardZones(items, jakarta).items.map(item => item.id)).toEqual(['a']);
  expect(hazardZones(items, null).items.map(item => item.id)).toEqual(['a', 'bali']);
});
