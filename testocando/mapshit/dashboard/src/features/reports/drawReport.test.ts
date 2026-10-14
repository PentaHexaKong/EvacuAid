import { expect, test, vi } from 'vitest'
import type { FieldReport } from '@/lib/types'
import type { MapAPI } from '@/map/glMap'
import { drawReport } from './drawReport'

test('Show on map draws exactly one report point, shows the layer and frames it', async () => {
  const map = { setLayer: vi.fn(), setVisible: vi.fn(), fit: vi.fn(), onClick: vi.fn(), pick: vi.fn(), cancelPick: vi.fn() } satisfies MapAPI
  drawReport(map, { kind: 'BLOCKED_ROAD', status: 'UNVERIFIED', latitude: -6.2, longitude: 106.8 } as FieldReport)
  const [id, fc] = map.setLayer.mock.calls[0] as Parameters<MapAPI['setLayer']>
  expect(id).toBe('report')
  expect(fc.features).toHaveLength(1)
  expect(fc.features[0]).toMatchObject({ geometry: { type: 'Point', coordinates: [106.8, -6.2] }, properties: { tooltip: 'Blocked road · Unverified' } })
  expect(map.setVisible).toHaveBeenCalledWith('report', true)
  await new Promise(requestAnimationFrame)
  const [[west, south], [east, north]] = map.fit.mock.calls[0]?.[0] as [[number, number], [number, number]]
  expect([west, south, east, north].map(v => v.toFixed(6))).toEqual(["106.798000", "-6.202000", "106.802000", "-6.198000"])
})
