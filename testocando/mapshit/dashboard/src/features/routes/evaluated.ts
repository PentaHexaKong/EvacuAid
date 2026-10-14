import { useSyncExternalStore } from 'react'
import type { DataMode, Geometry, OperationalRoute } from '@/lib/types'
import type { Feature } from '@/map/glMap'
import { time } from '@/lib/format'
// The route id ties the drawing to live route data, so a withdrawn, demoted or expired route stops showing as usable.
export type Evaluated = { routeId: string; geometry: Geometry }
let value: Evaluated | null = null
const listeners = new Set<() => void>()
export function getEvaluated() { return value }
export function setEvaluated(next: Evaluated) { value = next; listeners.forEach(listener => { listener() }) }
export function clearEvaluated() { if (!value) return; value = null; listeners.forEach(listener => { listener() }) }
export function subscribeEvaluated(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useEvaluated() { return useSyncExternalStore(subscribeEvaluated, getEvaluated) }
export function mergeRouteFeatures(routes: OperationalRoute[], evaluated: Evaluated | null, mode: DataMode): Feature[] {
  if (mode !== 'REFERENCE') return []
  const features: Feature[] = routes.flatMap(route => route.usable && route.result.route?.geometry ? [{ type: 'Feature', geometry: route.result.route.geometry, properties: { color: '#176D60', weight: 3, tooltip: route.name + ' · expires ' + time(route.expiresAt) + ' · safety not verified' } }] : [])
  const live = evaluated && routes.find(route => route.id === evaluated.routeId)
  if (evaluated && live) features.push({ type: 'Feature', geometry: evaluated.geometry, properties: { color: live.usable ? '#176D60' : '#8C97B3', weight: 3, dashed: !live.usable } })
  return features
}
