import { expect, test, vi } from 'vitest'
import { pickAssembly } from './pick'
import type { MapAPI } from '@/map/glMap'
import { renderHook } from '@testing-library/react'
import { useRouteFields } from './formState'

test('map pick returns to routes with coordinates and never cancels a completed pick', async () => {
  let finish!: (point: [number, number]) => void
  const cancel = vi.fn()
  const map = { pick: () => new Promise<[number, number]>(resolve => { finish = resolve }), cancelPick: cancel } as unknown as MapAPI
  const navigate = vi.fn((path: string) => { window.history.replaceState(null, '', '#' + path) })
  const picking = pickAssembly(map, navigate)
  expect(navigate).toHaveBeenCalledWith('/overview')
  finish([106.8, -6.2])
  await picking
  const { result } = renderHook(useRouteFields)
  expect(result.current).toMatchObject({ longitude: '106.8', latitude: '-6.2', feedback: 'Origin selected. Choose a recorded shelter and calculate.' })
  expect(navigate).toHaveBeenLastCalledWith('/operations/routes')
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(cancel).not.toHaveBeenCalled()
})
test('leaving the overview cancels only the still pending owned pick', async () => {
  let reject!: (error: Error) => void
  const cancel = vi.fn(() => { reject(new DOMException('Cancelled', 'AbortError')) })
  const map = { pick: () => new Promise<[number, number]>((_, fail) => { reject = fail }), cancelPick: cancel } as unknown as MapAPI
  const navigate = vi.fn((path: string) => { window.history.replaceState(null, '', '#' + path) })
  const picking = pickAssembly(map, navigate)
  window.history.replaceState(null, '', '#/operations/assistance')
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await picking
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(cancel).toHaveBeenCalledTimes(1)
})
test('a replacement map pick does not let the old owner cancel it later', async () => {
  const cancel = vi.fn()
  const map = { pick: () => Promise.reject(new DOMException('Cancelled', 'AbortError')), cancelPick: cancel } as unknown as MapAPI
  await pickAssembly(map, () => {})
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(cancel).not.toHaveBeenCalled()
})

test('router view cleanup cancels the pending assembly pick without relying on hashchange', async () => {
  const { cancelAssemblyPick } = await import('./pick')
  let reject!: (error: Error) => void
  const cancel = vi.fn(() => { reject(new DOMException('Cancelled', 'AbortError')) })
  const map = { pick: () => new Promise<[number, number]>((_, fail) => { reject = fail }), cancelPick: cancel } as unknown as MapAPI
  const picking = pickAssembly(map, () => {})
  cancelAssemblyPick()
  await picking
  expect(cancel).toHaveBeenCalledTimes(1)
  cancelAssemblyPick()
  expect(cancel).toHaveBeenCalledTimes(1)
})
