import { execFileSync } from 'node:child_process';
import { dijkstra, distance, interpolate, nearestReachable, snapDestination, MAX_DESTINATION_SNAP_METERS, type Edge, type Graph, type Coordinate } from './routing';
import { endpoints, graph, presets, selectRoute } from './sample';
import source from './data/osm-source.json';
import prepared from './data/graph.json';

const nodes: Graph['nodes'] = ['a', 'b', 'c', 'd', 'isolated'].map((id, index) => ({ id, coordinate: [106.8 + index / 1000, -6.26] }));
const edge = (id: string, from: string, to: string, length: number, direction: Edge['direction'] = 'both'): Edge => ({ id, from, to, distance: length, direction, sourceWay: 1, geometry: [nodes.find(n => n.id === from)!.coordinate, nodes.find(n => n.id === to)!.coordinate] });
const fixture: Graph = { nodes, edges: [edge('ab', 'a', 'b', 1), edge('bd', 'b', 'd', 2), edge('ac', 'a', 'c', 4), edge('cd', 'c', 'd', 1)] };

test('Dijkstra chooses the shortest available path and removes blocked traversals in both directions', () => {
  expect(dijkstra(fixture, 'a', 'd')).toMatchObject({ reachable: true, distance: 3, segments: [{ id: 'ab' }, { id: 'bd' }] });
  expect(dijkstra(fixture, 'a', 'd', ['bd'])).toMatchObject({ reachable: true, distance: 5 });
  expect(dijkstra(fixture, 'd', 'a', ['bd'])).toMatchObject({ reachable: true, distance: 5, geometry: [nodes[3].coordinate, nodes[2].coordinate, nodes[0].coordinate] });
  expect(dijkstra(fixture, 'a', 'd', ['ab', 'ac'])).toEqual({ reachable: false });
  expect(dijkstra(fixture, 'a', 'isolated')).toEqual({ reachable: false });
  expect(dijkstra(fixture, 'missing', 'a')).toEqual({ reachable: false });
  expect(dijkstra(fixture, 'a', 'a')).toEqual({ reachable: true, distance: 0, segments: [], geometry: [nodes[0].coordinate] });
});

test('directed and zero-distance edges are honored; negative weights are rejected', () => {
  const directed: Graph = { nodes, edges: [edge('ab', 'a', 'b', 0, 'forward'), edge('cb', 'c', 'b', 2, 'backward')] };
  expect(dijkstra(directed, 'a', 'c')).toMatchObject({ reachable: true, distance: 2 });
  expect(dijkstra(directed, 'c', 'a')).toEqual({ reachable: false });
  expect(() => dijkstra({ nodes, edges: [edge('bad', 'a', 'b', -1)] }, 'a', 'b')).toThrow('Invalid edge distance');
});

test('nearest reachable compares graph distance, skips disconnected destinations, and changes when blocked', () => {
  expect(nearestReachable(fixture, 'a', ['isolated', 'c', 'd'])?.destination).toBe('d');
  expect(nearestReachable(fixture, 'a', ['c', 'd'], ['bd'])?.destination).toBe('c');
  expect(nearestReachable(fixture, 'a', ['isolated'])).toBeUndefined();
});

test('interpolation follows cumulative geometry distance with clamping and duplicate points', () => {
  const geometry: Coordinate[] = [[0, 0], [0, 0], [0.001, 0], [0.004, 0]];
  expect(interpolate(geometry, 0.5)[0]).toBeCloseTo(0.002, 8);
  expect(interpolate(geometry, -1)).toEqual([0, 0]);
  expect(interpolate(geometry, 2)).toEqual([0.004, 0]);
  expect(interpolate([[1, 1]], 0.5)).toEqual([1, 1]);
  expect(() => interpolate([], 0)).toThrow('Empty route geometry');
});

test('bundled graph is reproducible, attributed, bounded, and preserves source geometry and directions', () => {
  expect(execFileSync('python3', ['scripts/prepare-route-graph.py', '--check'], { encoding: 'utf8' })).toContain('Validated');
  expect(graph.nodes.length).toBeLessThanOrEqual(500);
  expect(prepared.source).toMatchObject({ attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  const sourceNodes = new Map(source.elements.filter(n => n.type === 'node').map(n => [String(n.id), n]));
  for (const node of graph.nodes) {
    const raw = sourceNodes.get(node.id)!;
    expect(node.coordinate).toEqual([raw.lon, raw.lat]);
    expect(node.coordinate[0]).toBeGreaterThanOrEqual(106.8);
    expect(node.coordinate[0]).toBeLessThanOrEqual(106.82);
    expect(node.coordinate[1]).toBeGreaterThanOrEqual(-6.276);
    expect(node.coordinate[1]).toBeLessThanOrEqual(-6.258);
  }
  const sourceWays = new Map(source.elements.filter(w => w.type === 'way').map(w => [w.id, w]));
  for (const edge of graph.edges) {
    const ids = sourceWays.get(edge.sourceWay)!.nodes!;
    const start = ids.indexOf(Number(edge.from));
    const end = ids.indexOf(Number(edge.to));
    expect(edge.geometry).toEqual(ids.slice(start, end + 1).map(id => {
      const raw = sourceNodes.get(String(id))!;
      return [raw.lon, raw.lat];
    }));
    expect(['both', 'forward', 'backward']).toContain(edge.direction);
    expect(Number.isFinite(edge.distance)).toBe(true);
    expect(edge.distance).toBeGreaterThanOrEqual(0);
    expect(edge.distance).toBeCloseTo(edge.geometry.slice(1).reduce((sum, point, index) => sum + distance(edge.geometry[index], point), 0), 5);
  }
});

test('every prepared destination detours and becomes unreachable under its prescribed presets', () => {
  const before = JSON.stringify(graph);
  for (const scenario of ['shelter', 'buddy'] as const) {
    for (const shelter of ['nearest', 'hall', 'center'] as const) {
      const clear = selectRoute(scenario, shelter, 'clear');
      const blocked = selectRoute(scenario, shelter, 'blocked');
      const cut = selectRoute(scenario, shelter, 'cut');
      expect(clear.route.reachable).toBe(true);
      expect(blocked.route.reachable).toBe(true);
      if (clear.route.reachable && blocked.route.reachable) {
        expect(blocked.route.distance).toBeGreaterThan(clear.route.distance + 50);
        expect(blocked.route.segments.every(segment => !presets[scenario].blocked.includes(segment.id))).toBe(true);
      }
      expect(cut.route).toEqual({ reachable: false });
      if (scenario === 'shelter' && shelter !== 'nearest') expect(cut.destination).toBe(endpoints[shelter]);
    }
    for (const ids of Object.values(presets[scenario])) for (const id of ids) expect(graph.edges.some(edge => edge.id === id)).toBe(true);
  }
  expect(selectRoute('shelter', 'nearest', 'clear').destination).toBe(endpoints.center);
  expect(JSON.stringify(graph)).toBe(before);
});

test('destination snapping chooses the closest vertex within 150 metres and rejects invalid or distant points', () => {
  const tiny: Graph = { nodes: [{ id: 'a', coordinate: [0, 0] }, { id: 'b', coordinate: [0.001, 0] }], edges: [] };
  expect(snapDestination(tiny, [0.0009, 0])?.node.id).toBe('b');
  expect(snapDestination(tiny, [0, 0])?.distance).toBe(0);
  const metresToDegrees = 180 / (6371000 * Math.PI);
  expect(snapDestination(tiny, [0, (MAX_DESTINATION_SNAP_METERS - 1) * metresToDegrees])).toBeDefined();
  expect(snapDestination(tiny, [0, (MAX_DESTINATION_SNAP_METERS + 1) * metresToDegrees])).toBeUndefined();
  expect(snapDestination({ nodes: [], edges: [] }, [0, 0])).toBeUndefined();
  for (const coordinate of [[NaN, 0], [Infinity, 0], [181, 0], [0, 91]] as Coordinate[]) expect(snapDestination(tiny, coordinate)).toBeUndefined();
});

test('custom routing uses the picked vertex and preserves it even when unreachable under a preset', () => {
  const custom = graph.nodes.find(node => !Object.values(endpoints).includes(node.id))!;
  for (const scenario of ['shelter', 'buddy'] as const) {
    for (const preset of ['clear', 'blocked', 'cut'] as const) {
      const result = selectRoute(scenario, 'nearest', preset, custom.id);
      expect(result.destination).toBe(custom.id);
      expect(result.route).toEqual(dijkstra(graph, result.origin, custom.id, presets[scenario][preset]));
      if (result.route.reachable) expect(result.route.geometry.at(-1)).toEqual(custom.coordinate);
    }
  }
  expect(selectRoute('shelter', 'nearest', 'clear', endpoints.person).route).toMatchObject({ reachable: true, distance: 0 });
});
