import prepared from './data/graph.json';
import { dijkstra, nearestReachable, type Coordinate, type Edge, type Graph, type Route } from './routing';

export const graph: Graph = {
  nodes: prepared.nodes.map(node => ({ ...node, coordinate: node.coordinate as Coordinate })),
  edges: prepared.edges.map(edge => ({ ...edge, direction: edge.direction as Edge['direction'], geometry: edge.geometry as Coordinate[] })),
};
export const endpoints = prepared.endpoints;
export type Scenario = 'shelter' | 'buddy';
export type Shelter = 'nearest' | 'hall' | 'center';
export type Preset = 'clear' | 'blocked' | 'cut';
export const presets: Record<Scenario, Record<Preset, string[]>> = {
  shelter: {
    clear: [],
    blocked: ['w500869933:6331279551-355635307', 'w31769358:4918250472-355635351'],
    cut: ['w500869933:355635362-6331279551', 'w500869933:6331279551-355635307'],
  },
  buddy: {
    clear: [],
    blocked: ['w491072482:5490508868-355636674'],
    cut: ['w500869933:355635362-6331279551', 'w500869933:6331279551-355635307'],
  },
};
export function selectRoute(scenario: Scenario, shelter: Shelter, preset: Preset, destinationOverride?: string): { origin: string; destination?: string; route: Route } {
  const origin = scenario === 'buddy' ? endpoints.buddy : endpoints.person;
  const blocked = presets[scenario][preset];
  if (destinationOverride) return { origin, destination: destinationOverride, route: dijkstra(graph, origin, destinationOverride, blocked) };
  if (scenario === 'shelter' && shelter === 'nearest') {
    const nearest = nearestReachable(graph, origin, [endpoints.hall, endpoints.center], blocked);
    return nearest ? { origin, ...nearest } : { origin, route: { reachable: false } };
  }
  const destination = scenario === 'buddy' ? endpoints.person : endpoints[shelter as 'hall' | 'center'];
  return { origin, destination, route: dijkstra(graph, origin, destination, blocked) };
}
