import { afterEach, expect, test } from 'vitest'
import { clearEvaluated, getEvaluated, setEvaluated, subscribeEvaluated, mergeRouteFeatures } from './evaluated'
import type { OperationalRoute } from '@/lib/types'
import routes from '../../../tests/e2e/fixtures/operational-routes.json'
afterEach(clearEvaluated)
test('stores one evaluated geometry and notifies on replacement and clearing', () => {
  let changes = 0
  const unsubscribe = subscribeEvaluated(() => { changes++ })
  const value = { routeId: 'route-1', geometry: routes.at(0)?.result.route.geometry ?? { type: 'LineString', coordinates: [] } }
  setEvaluated(value)
  expect(getEvaluated()).toBe(value)
  clearEvaluated()
  expect(getEvaluated()).toBeNull()
  expect(changes).toBe(2)
  unsubscribe()
})
test('Overview merges usable published routes and styles the evaluated geometry from live route data', () => {
  const published = routes as OperationalRoute[]
  const first = published.at(0)
  if (!first) throw new Error('Route fixture required')
  const evaluated = { routeId: first.id, geometry: first.result.route?.geometry ?? { type: 'LineString', coordinates: [] } }
  const usable = mergeRouteFeatures(published, evaluated, 'REFERENCE')
  expect(usable.at(0)?.properties).toMatchObject({ color: '#176D60', weight: 3 })
  expect(usable.at(-1)).toMatchObject({ geometry: evaluated.geometry, properties: { color: '#176D60', dashed: false } })
  // Withdrawn or demoted since it was shown: the same drawing turns grey and dashed.
  expect(mergeRouteFeatures([{ ...first, usable: false }], evaluated, 'REFERENCE')).toEqual([{ type: 'Feature', geometry: evaluated.geometry, properties: { color: '#8C97B3', weight: 3, dashed: true } }])
  // Gone from the route list: nothing is drawn.
  expect(mergeRouteFeatures([], evaluated, 'REFERENCE')).toEqual([])
  expect(mergeRouteFeatures(published, evaluated, 'SIMULATION')).toEqual([])
})

test('switching Data environment to SIMULATION clears the evaluated store', async () => {
  const { render, fireEvent, screen, cleanup } = await import('@testing-library/react')
  const { DataModeProvider, useDataMode } = await import('@/app/data-mode')
  const { createElement } = await import('react')
  function SwitchMode() {
    const { setDataMode } = useDataMode()
    return createElement('button', { onClick: () => { setDataMode('SIMULATION') } }, 'Simulation data')
  }
  setEvaluated({ routeId: 'route-1', geometry: { type: 'LineString', coordinates: [[106.8, -6.2], [106.9, -6.3]] } })
  render(createElement(DataModeProvider, null, createElement(SwitchMode)))
  fireEvent.click(screen.getByRole('button', { name: 'Simulation data' }))
  expect(getEvaluated()).toBeNull()
  cleanup()
})
