const MIN_SPAN = 0.003;
// The map buttons sit in a box this tall; the screen fades them once the sheet reaches its lower edge.
export const MAP_CONTROLS_BOX = 96;
export type Bounds = { ne: [number, number]; sw: [number, number] };
type Insets = { top: number; right: number; bottom: number; left: number };

const toMercator = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
const fromMercator = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

// The same view as center + zoom (512pt tiles). A tilted camera pivots on this center, so framing survives the pitch,
// whereas fitting bounds while tilted squeezes the whole box, sheet area included, into the trapezoid.
export function boundsCenter({ ne, sw }: Bounds, width: number) {
  const centerY = (toMercator(ne[1]) + toMercator(sw[1])) / 2;
  return { centerCoordinate: [(ne[0] + sw[0]) / 2, fromMercator(centerY)] as [number, number], zoomLevel: Math.log2((width * 360) / (512 * (ne[0] - sw[0]))) };
}

export function visibleBounds(points: [number, number][], insets: Insets, size: { width: number; height: number }): Bounds {
  const xs = points.map(point => (point[0] * Math.PI) / 180);
  const ys = points.map(point => toMercator(point[1]));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const minSpan = (MIN_SPAN * Math.PI) / 180;
  const spanX = Math.max(minSpan, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(minSpan, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min(Math.max(1, size.width - insets.left - insets.right) / spanX, Math.max(1, size.height - insets.top - insets.bottom) / spanY);
  const middleX = centerX + (insets.right - insets.left) / (2 * scale);
  const middleY = centerY - (insets.bottom - insets.top) / (2 * scale);
  const halfWidth = size.width / (2 * scale);
  const halfHeight = size.height / (2 * scale);
  const toLongitude = (x: number) => (x * 180) / Math.PI;
  return { ne: [toLongitude(middleX + halfWidth), fromMercator(middleY + halfHeight)], sw: [toLongitude(middleX - halfWidth), fromMercator(middleY - halfHeight)] };
}
