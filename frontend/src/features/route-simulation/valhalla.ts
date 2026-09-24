import type { Coordinate, Route } from './routing';

export type ValhallaRouteRequest = { origin: Coordinate; destination: Coordinate; excludePolygons?: Coordinate[][] };
const noRouteCodes = [170, 171, 441, 442];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Valhalla response');
  return value as Record<string, unknown>;
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid Valhalla distance or time');
  return value;
}
function coordinate(value: unknown): asserts value is Coordinate {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === 'number' && Number.isFinite(n)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error('Invalid routing coordinate');
}
export function valhallaRequest({ origin, destination, excludePolygons = [] }: ValhallaRouteRequest) {
  coordinate(origin);
  coordinate(destination);
  for (const ring of excludePolygons) {
    ring.forEach(coordinate);
    if (ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1] || new Set(ring.map(point => point.join(','))).size < 3) throw new Error('Invalid exclusion polygon');
  }
  return {
    locations: [origin, destination].map(([lon, lat]) => ({ lat, lon, type: 'break' as const })),
    costing: 'pedestrian' as const,
    costing_options: { pedestrian: { walking_speed: 4.32 } },
    units: 'kilometers' as const,
    format: 'json' as const,
    ...(excludePolygons.length ? { exclude_polygons: excludePolygons } : {}),
  };
}
function decodeShape(shape: unknown): Coordinate[] {
  if (typeof shape !== 'string' || !shape.length) throw new Error('Invalid Valhalla shape');
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const component = () => {
    let result = 0;
    for (let shift = 0; shift <= 30 && index < shape.length; shift += 5) {
      const byte = shape.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid Valhalla shape');
      result += (byte % 32) * 2 ** shift;
      if (byte < 32) return result % 2 ? -(result + 1) / 2 : result / 2;
    }
    throw new Error('Invalid Valhalla shape');
  };
  const geometry: Coordinate[] = [];
  while (index < shape.length) {
    latitude += component();
    longitude += component();
    const point: Coordinate = [longitude / 1e6, latitude / 1e6];
    coordinate(point);
    geometry.push(point);
  }
  return geometry;
}
export function routeFromValhalla(payload: unknown): Route {
  const response = object(payload);
  if (noRouteCodes.includes(response.error_code as number)) return { reachable: false };
  if (response.error_code !== undefined) throw new Error('Valhalla could not calculate the route');
  const trip = object(response.trip);
  if (trip.status !== 0 || !Array.isArray(trip.legs) || !trip.legs.length) throw new Error('Invalid Valhalla trip');
  const unit = trip.units === 'kilometers' ? 1000 : trip.units === 'miles' ? 1609.344 : undefined;
  if (!unit) throw new Error('Invalid Valhalla units');
  const summary = object(trip.summary);
  const distance = nonnegative(nonnegative(summary.length) * unit);
  const geometry: Coordinate[] = [];
  const segments: Extract<Route, { reachable: true }>['segments'] = [];
  trip.legs.forEach((value, legIndex) => {
    const leg = object(value);
    const shape = decodeShape(leg.shape);
    const last = geometry.at(-1);
    if (last && (last[0] !== shape[0][0] || last[1] !== shape[0][1])) throw new Error('Disconnected Valhalla geometry');
    for (const point of last ? shape.slice(1) : shape) geometry.push(point);
    if (!Array.isArray(leg.maneuvers) || !leg.maneuvers.length) throw new Error('Invalid Valhalla maneuvers');
    leg.maneuvers.forEach((value, maneuverIndex) => {
      const maneuver = object(value);
      const begin = nonnegative(maneuver.begin_shape_index);
      const end = nonnegative(maneuver.end_shape_index);
      if (!Number.isInteger(begin) || !Number.isInteger(end) || end < begin || end >= shape.length) throw new Error('Invalid Valhalla maneuver indices');
      const names = maneuver.street_names;
      if (names !== undefined && (!Array.isArray(names) || !names.every(name => typeof name === 'string'))) throw new Error('Invalid Valhalla street names');
      if (maneuver.instruction !== undefined && typeof maneuver.instruction !== 'string') throw new Error('Invalid Valhalla instruction');
      segments.push({ id: `valhalla:${legIndex}:${maneuverIndex}`, name: (names as string[] | undefined)?.join(' / '), distance: nonnegative(nonnegative(maneuver.length) * unit), geometry: shape.slice(begin, end + 1), instruction: maneuver.instruction as string | undefined });
    });
  });
  if (distance > 0 && geometry.length < 2) throw new Error('Invalid Valhalla geometry');
  return { reachable: true, distance, durationSeconds: nonnegative(summary.time), geometry, segments };
}
export async function requestValhallaRoute(endpoint: string, request: ValhallaRouteRequest, signal: AbortSignal): Promise<Route> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(valhallaRequest(request)), signal });
  const payload: unknown = await response.json();
  if (!response.ok && !(response.status === 400 && noRouteCodes.includes(object(payload).error_code as number))) throw new Error(`Routing service failed (${response.status})`);
  return routeFromValhalla(payload);
}
