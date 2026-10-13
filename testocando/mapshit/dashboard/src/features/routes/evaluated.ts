import { useSyncExternalStore } from 'react'
import type { DataMode, Geometry, OperationalRoute } from '@/lib/types'
import type { Feature } from '@/map/glMap'
import { time } from '@/features/overview/RegionPanel'
export type Evaluated = { geometry: Geometry; usable: boolean }
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
  if (evaluated) features.push({ type: 'Feature', geometry: evaluated.geometry, properties: { color: evaluated.usable ? '#176D60' : '#8C97B3', weight: 3, dashed: !evaluated.usable } })
  return features
}
