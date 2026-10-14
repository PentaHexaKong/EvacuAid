import { useSyncExternalStore } from 'react'
import type { RouteSet } from '@/lib/types'
export type RouteFields = Omit<RouteSet, 'originLatitude' | 'originLongitude'> & { latitude: string; longitude: string; feedback: string }
let fields: RouteFields = { id: '', name: '', regionId: '', shelterId: '', latitude: '', longitude: '', mobilityRequired: false, feedback: '' }
const listeners = new Set<() => void>()
export function updateRouteFields(next: Partial<RouteFields>) { fields = { ...fields, ...next }; listeners.forEach(listener => { listener() }) }
export function selectRouteRegion(regionId: string) { if (regionId !== fields.regionId) updateRouteFields({ regionId, id: '', shelterId: '' }) }
export function useRouteFields() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => fields) }
export function resetRouteFields() { updateRouteFields({ id: '', name: '', shelterId: '', latitude: '', longitude: '', mobilityRequired: false }) }

let mock = false
export function isMockMode() { return mock }
export function setMockMode(next: boolean) { mock = next; listeners.forEach(listener => { listener() }) }
export function useMockMode() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, isMockMode) }
