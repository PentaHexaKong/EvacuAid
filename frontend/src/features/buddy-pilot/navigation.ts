import type { Maneuver, Position } from './api';

export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const lat = (a.latitude + b.latitude) / 2 * radians;
  return Math.hypot((a.longitude - b.longitude) * radians * Math.cos(lat), (a.latitude - b.latitude) * radians) * 6371000;
}

export function routeProgress(position: Position, points: [number, number][], maneuvers: Maneuver[], now = Date.now(), previousSegmentIndex?: number) {
  const observedAt = Date.parse(position.observedAt);
  if (points.length < 2 || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 30000 || !Number.isFinite(position.accuracyM) || position.accuracyM < 0 || position.accuracyM > 30 || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) || points.some(point => point.some(value => !Number.isFinite(value)))) return null;
  const startIndex = previousSegmentIndex === undefined ? 0 : Math.max(0, Math.min(points.length - 2, Math.floor(previousSegmentIndex)));
  if (!Number.isFinite(startIndex)) return null;
  const scaleX = Math.cos(position.latitude * Math.PI / 180) * 111195;
  const scaleY = 111195;
  let bestDistance = Infinity;
  let bestIndex = startIndex;
  let fraction = 0;
  let lookAheadM = 0;
  for (let index = startIndex; index < points.length - 1; index++) {
    if (previousSegmentIndex !== undefined && index > startIndex + 1) {
      lookAheadM += distanceM({ longitude: points[index - 1][0], latitude: points[index - 1][1] }, { longitude: points[index][0], latitude: points[index][1] });
      if (lookAheadM > 75) break;
    }
    const a = { x: (points[index][0] - position.longitude) * scaleX, y: (points[index][1] - position.latitude) * scaleY };
    const b = { x: (points[index + 1][0] - position.longitude) * scaleX, y: (points[index + 1][1] - position.latitude) * scaleY };
    const dx = b.x - a.x; const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(a.x + dx * t, a.y + dy * t);
    const uncertaintyM = previousSegmentIndex === undefined ? 0 : Math.max(5, position.accuracyM);
    if (distance < bestDistance - uncertaintyM) { bestDistance = distance; bestIndex = index; fraction = t; }
  }
  let remainingM = 0;
  for (let index = bestIndex; index < points.length - 1; index++) {
    const length = distanceM({ longitude: points[index][0], latitude: points[index][1] }, { longitude: points[index + 1][0], latitude: points[index + 1][1] });
    remainingM += length * (index === bestIndex ? 1 - fraction : 1);
  }
  const maneuverIndex = maneuvers.findIndex(item => item.endShapeIndex > bestIndex);
  const last = points[points.length - 1];
  return { segmentIndex: bestIndex, offRouteM: bestDistance, remainingM, maneuverIndex: maneuverIndex < 0 ? Math.max(0, maneuvers.length - 1) : maneuverIndex, nearDestination: remainingM <= 25 && distanceM(position, { longitude: last[0], latitude: last[1] }) <= 25 };
}
