import { routeProgress } from './navigation';

test('progress follows route segments and rejects stale or inaccurate fixes', () => {
  const now = Date.now();
  const position = { latitude: 0, longitude: 0.0005, accuracyM: 5, observedAt: new Date(now).toISOString() };
  const points: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.001]];
  const maneuvers = [{ instruction: 'East', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 111, durationSec: 80, type: 1 }, { instruction: 'North', beginShapeIndex: 1, endShapeIndex: 2, distanceM: 111, durationSec: 80, type: 2 }];
  expect(routeProgress(position, points, maneuvers, now)).toEqual(expect.objectContaining({ offRouteM: 0, maneuverIndex: 0, nearDestination: false }));
  expect(routeProgress(position, points, maneuvers, now)!.remainingM).toBeCloseTo(166.8, 0);
  expect(routeProgress({ ...position, longitude: 0.001, latitude: 0.00095 }, points, maneuvers, now)).toEqual(expect.objectContaining({ maneuverIndex: 1, nearDestination: true }));
  expect(routeProgress({ ...position, accuracyM: 100 }, points, maneuvers, now)).toBeNull();
  expect(routeProgress(position, points, maneuvers, now + 31000)).toBeNull();
});


test('rejects invalid or future fixes and does not jump across nearby hairpin segments', () => {
  const now = Date.now();
  const position = { latitude: 0.00003, longitude: 0.0005, accuracyM: 5, observedAt: new Date(now).toISOString() };
  const points: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.00004], [0, 0.00004]];
  expect(routeProgress(position, points, [], now, 0)?.segmentIndex).toBe(0);
  expect(routeProgress(position, points, [], now, 2)?.segmentIndex).toBe(2);
  expect(routeProgress({ ...position, observedAt: 'invalid' }, points, [], now, 0)).toBeNull();
  expect(routeProgress({ ...position, observedAt: new Date(now + 1).toISOString() }, points, [], now, 0)).toBeNull();
});

test('bounds forward progress at crossing routes and does not announce arrival near an early loop', () => {
  const now = Date.now();
  const points: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0.0001]];
  const position = { latitude: 0.0001, longitude: 0, accuracyM: 5, observedAt: new Date(now).toISOString() };
  const progress = routeProgress(position, points, [], now, 0);
  expect(progress?.segmentIndex).toBe(0);
  expect(progress?.nearDestination).toBe(false);
});
