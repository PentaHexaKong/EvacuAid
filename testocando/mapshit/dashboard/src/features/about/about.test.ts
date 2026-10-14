import { expect, test } from 'vitest'
import { aboutText } from './index'

test('about copy matches the legacy sentences', () => {
  expect(aboutText(undefined)).toBe('Operational data. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. Hazard and shelter overlays load when a region is selected.')
  expect(aboutText([{ snapshotStale: true }, { snapshotStale: false }])).toBe('Operational data. 2 regions in the current filter scope. 1 unavailable/stale projections. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. Hazard and shelter overlays load when a region is selected.')
  expect(aboutText([])).toMatch(/0 regions .* Import administrative GeoJSON using the command importer\.$/)
})
