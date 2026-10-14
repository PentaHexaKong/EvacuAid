import { beforeEach, expect, it } from 'vitest'
import { loadMocks, saveMocks, clearMocks, storageKey } from './mockStore'

beforeEach(() => { localStorage.clear(); })
it('round-trips a disaster and clears it', () => {
  const disaster = { id: 'test', kind: 'hazard' as const, name: 'Flood', latitude: -6.2, longitude: 106.8, hazardType: 'FLOOD' as const, severity: 'WATCH' as const, radiusM: 1000 }
  saveMocks([disaster])
  expect(loadMocks()).toEqual([disaster])
  clearMocks()
  expect(loadMocks()).toEqual([])
})
it('ignores corrupt JSON', () => {
  localStorage.setItem(storageKey, '{broken')
  expect(loadMocks()).toEqual([])
})
it('ignores invalid coordinates and limits stored items to 200', () => {
  const house = { id: 'house', kind: 'safeHouse', name: 'House', latitude: -6.2, longitude: 106.8 }
  localStorage.setItem(storageKey, JSON.stringify([{ ...house, latitude: 91 }, ...Array.from({ length: 201 }, () => house)]))
  expect(loadMocks()).toHaveLength(200)
})
