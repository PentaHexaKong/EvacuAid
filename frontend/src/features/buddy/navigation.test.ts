import { formatDistance, instructionText, routeProgress, turnOf } from './navigation';

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

test('distance to the next turn counts along the route and is zero on the last maneuver', () => {
  const now = Date.now();
  const position = { latitude: 0, longitude: 0.0005, accuracyM: 5, observedAt: new Date(now).toISOString() };
  const points: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001]];
  const step = { instruction: '', distanceM: 111, durationSec: 80, type: 10 };
  const maneuvers = [{ ...step, beginShapeIndex: 0, endShapeIndex: 1 }, { ...step, beginShapeIndex: 1, endShapeIndex: 2 }, { ...step, beginShapeIndex: 2, endShapeIndex: 3 }];
  expect(routeProgress(position, points, maneuvers, now)!.nextManeuverM).toBeCloseTo(55.6, 0);
  const last = routeProgress({ ...position, latitude: 0.001, longitude: 0.0015 }, points, maneuvers, now)!;
  expect(last.maneuverIndex).toBe(2);
  expect(last.nextManeuverM).toBeCloseTo(last.remainingM, 5);
  expect(routeProgress(position, points, [], now)!.nextManeuverM).toBeCloseTo(277.9, 0);
});

test('instructions are written in the app language from the maneuver type and street', () => {
  const maneuver = (type: number, streetNames?: string[]) => ({ instruction: 'Engine text.', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 1, durationSec: 1, type, streetNames });
  expect(instructionText(maneuver(10, ['Jalan Melati', 'Jalan Lain']), 'id')).toBe('Belok kanan ke Jalan Melati');
  expect(instructionText(maneuver(10, ['Jalan Melati']), 'en')).toBe('Turn right onto Jalan Melati');
  expect(instructionText(maneuver(15), 'id')).toBe('Belok kiri');
  expect(instructionText(maneuver(1, ['Jalan Melati']), 'id')).toBe('Mulai berjalan di Jalan Melati');
  expect(instructionText(maneuver(8, ['Jalan Melati']), 'en')).toBe('Continue straight on Jalan Melati');
  expect(instructionText(maneuver(4, ['Jalan Melati']), 'id')).toBe('Kamu sudah tiba');
  expect(instructionText(maneuver(12, ['Jalan Melati']), 'en')).toBe('Make a U-turn');
  expect(instructionText(maneuver(99, ['Jalan Melati']), 'id')).toBe('Engine text.');
  for (const type of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 40]) expect(turnOf(type)).not.toBeNull();
  expect(turnOf(0)).toBeNull();
});

test('distances switch to kilometres with the locale decimal mark', () => {
  expect(formatDistance(849.6, 'id')).toBe('850 m');
  expect(formatDistance(1234, 'id')).toBe('1,2 km');
  expect(formatDistance(1234, 'en')).toBe('1.2 km');
});
