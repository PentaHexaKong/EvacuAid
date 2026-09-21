export type Coordinate = [number, number];
export type Vertex = { id: string; coordinate: Coordinate };
export type Edge = { id: string; sourceWay: number; from: string; to: string; direction: 'both' | 'forward' | 'backward'; name?: string; geometry: Coordinate[]; distance: number };
export type Graph = { nodes: Vertex[]; edges: Edge[] };
export type Route = { reachable: true; distance: number; geometry: Coordinate[]; durationSeconds?: number; segments: { id: string; name?: string; distance: number; geometry: Coordinate[]; instruction?: string; to?: string }[] } | { reachable: false };

export function distance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export const MAX_DESTINATION_SNAP_METERS = 150;
export function snapDestination(graph: Graph, coordinate: Coordinate) {
  if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) return undefined;
  let nearest: { node: Vertex; distance: number } | undefined;
  for (const node of graph.nodes) {
    const offset = distance(coordinate, node.coordinate);
    if (offset <= MAX_DESTINATION_SNAP_METERS && (!nearest || offset < nearest.distance)) nearest = { node, distance: offset };
  }
  return nearest;
}

export function dijkstra(graph: Graph, origin: string, destination: string, blocked: readonly string[] = []): Route {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (!nodes.has(origin) || !nodes.has(destination)) return { reachable: false };
  const denied = new Set(blocked);
  const pending = new Set(nodes.keys());
  const distances = new Map([[origin, 0]]);
  const previous = new Map<string, { from: string; edge: Edge; reverse: boolean }>();
  const adjacency = new Map<string, { to: string; edge: Edge; reverse: boolean }[]>();
  for (const edge of graph.edges) {
    if (!Number.isFinite(edge.distance) || edge.distance < 0) throw new Error('Invalid edge distance');
    if (denied.has(edge.id)) continue;
    if (edge.direction !== 'backward') adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { to: edge.to, edge, reverse: false }]);
    if (edge.direction !== 'forward') adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { to: edge.from, edge, reverse: true }]);
  }
  while (pending.size) {
    let current: string | undefined;
    let best = Infinity;
    for (const id of pending) if ((distances.get(id) ?? Infinity) < best) { current = id; best = distances.get(id)!; }
    if (current === undefined) break;
    pending.delete(current);
    if (current === destination) {
      const segments: Extract<Route, { reachable: true }>['segments'] = [];
      let cursor = destination;
      while (cursor !== origin) {
        const step = previous.get(cursor)!;
        segments.unshift({ id: step.edge.id, name: step.edge.name, distance: step.edge.distance, geometry: step.reverse ? [...step.edge.geometry].reverse() : step.edge.geometry, to: cursor });
        cursor = step.from;
      }
      return { reachable: true, distance: best, segments, geometry: segments.length ? segments.flatMap((segment, index) => index ? segment.geometry.slice(1) : segment.geometry) : [nodes.get(origin)!.coordinate] };
    }
    for (const next of adjacency.get(current) ?? []) {
      const candidate = best + next.edge.distance;
      if (pending.has(next.to) && candidate < (distances.get(next.to) ?? Infinity)) {
        distances.set(next.to, candidate);
        previous.set(next.to, { from: current, edge: next.edge, reverse: next.reverse });
      }
    }
  }
  return { reachable: false };
}

export function nearestReachable(graph: Graph, origin: string, destinations: readonly string[], blocked: readonly string[] = []) {
  let best: { destination: string; route: Extract<Route, { reachable: true }> } | undefined;
  for (const destination of destinations) {
    const route = dijkstra(graph, origin, destination, blocked);
    if (route.reachable && (!best || route.distance < best.route.distance)) best = { destination, route };
  }
  return best;
}

export function interpolate(geometry: Coordinate[], fraction: number): Coordinate {
  if (!geometry.length) throw new Error('Empty route geometry');
  const lengths = geometry.slice(1).map((point, index) => distance(geometry[index], point));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, Math.min(1, fraction));
  for (let index = 0; index < lengths.length; index++) {
    if (lengths[index] > 0 && remaining <= lengths[index]) {
      const ratio = remaining / lengths[index];
      return [geometry[index][0] + (geometry[index + 1][0] - geometry[index][0]) * ratio, geometry[index][1] + (geometry[index + 1][1] - geometry[index][1]) * ratio];
    }
    remaining -= lengths[index];
  }
  return geometry[geometry.length - 1];
}
