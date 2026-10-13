import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MapAPI } from '@/map/glMap'
import { MockMode } from './MockMode'
import { setMockMode } from '@/features/routes/formState'
import { storageKey } from './mockStore'

const map = { setLayer: vi.fn(), setVisible: vi.fn(), fit: vi.fn(), onClick: vi.fn(() => () => {}), pick: vi.fn(() => new Promise<[number, number]>(() => {})), cancelPick: vi.fn() } satisfies MapAPI
const mutation = { mutateAsync: vi.fn(), isPending: false }
vi.mock('@/map/MapProvider', () => ({ useMap: () => map }))
vi.mock('@/lib/queries', () => ({
  useMockDisasters: () => ({ data: [], isPending: false, error: null }),
  useSafeHouses: () => ({ data: [], isPending: false, error: null }),
  useCreateMockDisaster: () => mutation, useCreateSafeHouse: () => mutation, useClearMockDisasters: () => mutation, useDeleteMockDisaster: () => mutation,
}))

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setMockMode(false) })
afterEach(cleanup)

test('in mock mode, saved mock safe houses are drawn as one mock feature each', async () => {
  localStorage.setItem(storageKey, JSON.stringify([{ kind: 'safeHouse', id: 'a', name: 'Masjid', latitude: -6.2, longitude: 106.8 }]))
  render(<MockMode filters={null} layers={null} refresh={() => Promise.resolve(null)} onBusyChange={() => {}} />)
  await userEvent.click(screen.getByRole('switch', { name: 'Mock mode' }))
  const mock = map.setLayer.mock.calls.filter(([id]) => id === 'mock').at(-1) as Parameters<MapAPI['setLayer']> | undefined
  expect(mock?.[1].features).toHaveLength(1)
  expect(mock?.[1].features[0]?.geometry).toEqual({ type: 'Point', coordinates: [106.8, -6.2] })
})

test('cancelling aborts only its own pick, and unmount leaves other picks alone', async () => {
  const { unmount } = render(<MockMode filters={null} layers={null} refresh={() => Promise.resolve(null)} onBusyChange={() => {}} />)
  unmount()
  expect(map.cancelPick).not.toHaveBeenCalled()

  render(<MockMode filters={null} layers={null} refresh={() => Promise.resolve(null)} onBusyChange={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add safe house' }))
  expect(map.pick).toHaveBeenCalledOnce()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel placement' }))
  await waitFor(() => { expect(map.cancelPick).toHaveBeenCalledOnce() })
})
