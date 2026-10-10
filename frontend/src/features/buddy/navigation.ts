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
  const found = maneuvers.findIndex(item => item.endShapeIndex > bestIndex);
  const maneuverIndex = found < 0 ? Math.max(0, maneuvers.length - 1) : found;
  const last = points[points.length - 1];
  let nextManeuverM = found < 0 && maneuvers.length ? 0 : remainingM;
  for (let index = maneuvers[maneuverIndex]?.endShapeIndex ?? points.length - 1; found >= 0 && index < points.length - 1; index++) nextManeuverM -= distanceM({ longitude: points[index][0], latitude: points[index][1] }, { longitude: points[index + 1][0], latitude: points[index + 1][1] });
  return { segmentIndex: bestIndex, offRouteM: bestDistance, remainingM, nextManeuverM: Math.max(0, nextManeuverM), maneuverIndex, nearDestination: remainingM <= 25 && distanceM(position, { longitude: last[0], latitude: last[1] }) <= 25 };
}

export type Turn = 'start' | 'straight' | 'slight-right' | 'right' | 'sharp-right' | 'uturn' | 'sharp-left' | 'left' | 'slight-left' | 'roundabout' | 'stairs' | 'arrive';

// Valhalla's maneuver types. A type that is missing here keeps the routing engine's own sentence.
const TURNS: Record<number, Turn> = { 1: 'start', 2: 'start', 3: 'start', 4: 'arrive', 5: 'arrive', 6: 'arrive', 7: 'straight', 8: 'straight', 17: 'straight', 22: 'straight', 27: 'straight', 9: 'slight-right', 23: 'slight-right', 10: 'right', 18: 'right', 20: 'right', 11: 'sharp-right', 12: 'uturn', 13: 'uturn', 14: 'sharp-left', 15: 'left', 19: 'left', 21: 'left', 16: 'slight-left', 24: 'slight-left', 26: 'roundabout', 40: 'stairs' };
export const turnOf = (type: number): Turn | null => TURNS[type] ?? null;

// [Indonesian, English, word that joins a street name in each language or null when the phrase takes none].
const PHRASES: Record<Turn, [string, string, [string, string] | null]> = {
  start: ['Mulai berjalan', 'Start walking', ['di', 'on']], straight: ['Lurus terus', 'Continue straight', ['di', 'on']],
  'slight-right': ['Agak ke kanan', 'Keep slightly right', ['ke', 'onto']], right: ['Belok kanan', 'Turn right', ['ke', 'onto']], 'sharp-right': ['Belok tajam ke kanan', 'Turn sharp right', ['ke', 'onto']],
  'slight-left': ['Agak ke kiri', 'Keep slightly left', ['ke', 'onto']], left: ['Belok kiri', 'Turn left', ['ke', 'onto']], 'sharp-left': ['Belok tajam ke kiri', 'Turn sharp left', ['ke', 'onto']],
  uturn: ['Putar balik', 'Make a U-turn', null], roundabout: ['Masuk bundaran', 'Enter the roundabout', null], stairs: ['Naik atau turun tangga', 'Take the stairs', null], arrive: ['Kamu sudah tiba', 'You have arrived', null],
};

export function turnPhrase(turn: Turn, language: 'id' | 'en') { return PHRASES[turn][language === 'id' ? 0 : 1]; }

export function instructionText(maneuver: Maneuver, language: 'id' | 'en') {
  const turn = turnOf(maneuver.type);
  if (!turn) return maneuver.instruction;
  const index = language === 'id' ? 0 : 1;
  const [, , join] = PHRASES[turn];
  const street = maneuver.streetNames?.[0];
  return join && street ? `${PHRASES[turn][index]} ${join[index]} ${street}` : PHRASES[turn][index];
}

export function formatDistance(meters: number, language: 'id' | 'en') {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = (meters / 1000).toFixed(1);
  return `${language === 'id' ? km.replace('.', ',') : km} km`;
}
