import { interpolate } from './routing';
import { requestValhallaRoute, routeFromValhalla, valhallaRequest } from './valhalla';

const response = () => ({ trip: { status: 0, units: 'kilometers', summary: { length: 0.314, time: 262 }, legs: [{
  shape: '~pa}J_hdvjEn}@o}@n}@o}@',
  maneuvers: [
    { begin_shape_index: 0, end_shape_index: 1, length: 0.157, street_names: ['Example street'], instruction: 'Walk along Example street.' },
    { begin_shape_index: 1, end_shape_index: 2, length: 0.157 },
    { begin_shape_index: 2, end_shape_index: 2, length: 0 },
  ],
}] } });
const request = { origin: [106.81, -6.26] as [number, number], destination: [106.812, -6.262] as [number, number] };

afterEach(() => jest.restoreAllMocks());

test('coordinate requests use walking, explicit units, and geographic exclusions without sample graph IDs', () => {
  expect(valhallaRequest(request)).toEqual({ locations: [{ lat: -6.26, lon: 106.81, type: 'break' }, { lat: -6.262, lon: 106.812, type: 'break' }], costing: 'pedestrian', costing_options: { pedestrian: { walking_speed: 4.32 } }, units: 'kilometers', format: 'json' });
  const excludePolygons: [number, number][][] = [[[106, -6], [106.1, -6], [106.1, -6.1], [106, -6]]];
  expect(valhallaRequest({ ...request, excludePolygons }).exclude_polygons).toEqual(excludePolygons);
  expect(() => valhallaRequest({ ...request, origin: [0, NaN] })).toThrow();
  expect(() => valhallaRequest({ ...request, destination: [181, 0] })).toThrow();
  expect(() => valhallaRequest({ ...request, excludePolygons: [[[0, 0], [1, 1]]] })).toThrow();
});

test('native Valhalla polyline6 and maneuvers become map and playback data in metres with longitude first', () => {
  const route = routeFromValhalla(response());
  expect(route).toMatchObject({ reachable: true, distance: 314, durationSeconds: 262, geometry: [[106.81, -6.26], [106.811, -6.261], [106.812, -6.262]], segments: [{ id: 'valhalla:0:0', name: 'Example street', distance: 157, instruction: 'Walk along Example street.', geometry: [[106.81, -6.26], [106.811, -6.261]] }, { id: 'valhalla:0:1', distance: 157 }, { id: 'valhalla:0:2', distance: 0 }] });
  if (!route.reachable) throw new Error('Expected route');
  expect(interpolate(route.geometry, 0)).toEqual(request.origin);
  expect(interpolate(route.geometry, 1)).toEqual(request.destination);
  expect(route.segments.every(segment => !('edge' in segment) && !('to' in segment))).toBe(true);
  const miles = response();
  miles.trip.units = 'miles';
  expect(routeFromValhalla(miles)).toMatchObject({ distance: 0.314 * 1609.344 });
});

test('multiple legs join without inventing connections and preserve distinct segment IDs', () => {
  const payload = response();
  payload.trip.legs.push({ shape: '~me}J_ehvjEn}@o}@', maneuvers: [{ begin_shape_index: 0, end_shape_index: 1, length: 0.157 }] });
  payload.trip.summary.length = 0.471;
  const route = routeFromValhalla(payload);
  expect(route).toMatchObject({ geometry: [[106.81, -6.26], [106.811, -6.261], [106.812, -6.262], [106.813, -6.263]], segments: expect.arrayContaining([expect.objectContaining({ id: 'valhalla:1:0' })]) });
  payload.trip.legs[1].shape = '~pa}J_hdvjE';
  expect(() => routeFromValhalla(payload)).toThrow('Disconnected');
});

test('no-route results are distinct from malformed data and service failures', () => {
  for (const error_code of [170, 171, 441, 442]) expect(routeFromValhalla({ error_code })).toEqual({ reachable: false });
  for (const payload of [null, {}, { error_code: 599 }]) expect(() => routeFromValhalla(payload)).toThrow();
  for (const shape of ['', '?', '~~~~~~~', '\u0000', '~pa}J_hdvjE']) {
    const payload = response();
    payload.trip.legs[0].shape = shape;
    expect(() => routeFromValhalla(payload)).toThrow();
  }
  const payload = response();
  payload.trip.legs[0].maneuvers[0].end_shape_index = 99;
  expect(() => routeFromValhalla(payload)).toThrow('indices');
  for (const length of [-1, NaN, Infinity]) {
    const invalid = response();
    invalid.trip.summary.length = length;
    expect(() => routeFromValhalla(invalid)).toThrow();
  }
});

test('the future backend client posts to the supplied endpoint and forwards cancellation without local fallback', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => response() } as Response);
  const controller = new AbortController();
  await expect(requestValhallaRoute('https://routing.example/route', request, controller.signal)).resolves.toMatchObject({ reachable: true, distance: 314 });
  expect(fetcher).toHaveBeenCalledWith('https://routing.example/route', expect.objectContaining({ method: 'POST', body: JSON.stringify(valhallaRequest(request)), signal: controller.signal }));
  fetcher.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error_code: 442 }) } as Response);
  await expect(requestValhallaRoute('https://routing.example/route', request, controller.signal)).resolves.toEqual({ reachable: false });
  fetcher.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error_code: 442 }) } as Response);
  await expect(requestValhallaRoute('https://routing.example/route', request, controller.signal)).rejects.toThrow('503');
  const abort = new Error('Aborted');
  abort.name = 'AbortError';
  fetcher.mockRejectedValueOnce(abort);
  await expect(requestValhallaRoute('https://routing.example/route', request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
