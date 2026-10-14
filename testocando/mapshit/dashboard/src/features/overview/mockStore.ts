import type { MockDisasterCreate, SafeHouseCreate } from '@/lib/types'

export const storageKey = 'evacuaid-command-mocks-v1'
export type MockItem = (SafeHouseCreate & { kind: 'safeHouse' }) | (MockDisasterCreate & { kind: 'hazard' })
export function loadMocks(): MockItem[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(stored) ? stored.filter((value: unknown): value is MockItem => {
      if (!value || typeof value !== 'object') return false
      const item = value as Record<string, unknown>
      return ['safeHouse', 'hazard'].includes(String(item.kind)) && typeof item.name === 'string' && typeof item.id === 'string' && typeof item.latitude === 'number' && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90 && typeof item.longitude === 'number' && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180
    }).slice(0, 200) : []
  } catch { return [] }
}
export function saveMocks(items: MockItem[]) { localStorage.setItem(storageKey, JSON.stringify(items)) }
export function clearMocks() { saveMocks([]) }
