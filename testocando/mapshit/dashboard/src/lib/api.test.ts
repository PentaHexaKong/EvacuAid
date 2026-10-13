import { createElement, type ReactNode } from 'react'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { CommandHeaderActions } from '@/components/app/app-shell'
import { DataModeProvider, useDataMode } from '@/app/data-mode'
import { api, allRegions } from './api'
import { mapConfig } from './config'
import { useRegions, useRegion, useSafeHouses, useMockDisasters, useReports, useAssistance, useCheckIns, useRoutes, useConnectionStatus, useAssistanceCounts, useConfirmReport, useRejectReport, useResolveReport, useUpdateAssistance, useCreateRoute, usePublishRoute, useWithdrawRoute, useCreateSafeHouse, useCreateMockDisaster, useClearMockDisasters, useDeleteMockDisaster } from './queries'

function requestUrl(input: Parameters<typeof fetch>[0]) { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url }
const fetchMock = vi.fn<typeof fetch>()
function respond(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status })
}
function setup() {
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, createElement(DataModeProvider, null, children))
  return { client, wrapper }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); delete window.EVACUAID_MAP })

test.each([
  [503, {}, 'EvacuAid backend is unavailable. Start the backend to load regional data.'],
  [400, { detail: { message: 'x' } }, 'x'],
  [409, { detail: 'Case changed; refresh before updating' }, 'Case changed; refresh before updating'],
])('api maps HTTP %s errors', async (status, body, message) => {
  setup(); fetchMock.mockResolvedValue(respond(body, status))
  await expect(api('regions')).rejects.toThrow(message)
})
test('api maps a non-JSON 500', async () => {
  setup(); fetchMock.mockResolvedValue(new Response('failed', { status: 500 }))
  await expect(api('regions')).rejects.toThrow('Unable to save or load command data (HTTP 500).')
})
test('api returns null for 204 and preserves the request contract', async () => {
  setup(); fetchMock.mockResolvedValue(respond(null, 204))
  await expect(api('mock-disasters', { method: 'DELETE', headers: { ignored: 'header' } })).resolves.toBeNull()
  expect(fetchMock).toHaveBeenCalledWith('/api/command/mock-disasters', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
})
test('allRegions collects 200 + 13 rows and overrides paging parameters', async () => {
  setup()
  const first = Array.from({ length: 200 }, (_, id) => ({ id: String(id) }))
  const last = Array.from({ length: 13 }, (_, id) => ({ id: String(id + 200) }))
  fetchMock.mockResolvedValueOnce(respond(first)).mockResolvedValueOnce(respond(last))
  expect(await allRegions({ dataMode: 'REFERENCE', administrativeLevel: 'VILLAGE', limit: '1', offset: '9' })).toEqual([...first, ...last])
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
    '/api/command/regions?dataMode=REFERENCE&administrativeLevel=VILLAGE&limit=200&offset=0',
    '/api/command/regions?dataMode=REFERENCE&administrativeLevel=VILLAGE&limit=200&offset=200',
  ])
})
test('mapConfig reads runtime values and the server default style', () => {
  expect(mapConfig()).toEqual({ token: undefined, style: 'mapbox/standard' })
  window.EVACUAID_MAP = { mapboxToken: 'pk.runtime', mapboxStyle: 'mapbox/custom' }
  expect(mapConfig()).toEqual({ token: 'pk.runtime', style: 'mapbox/custom' })
})
test('regions query key and URL change with the data environment', async () => {
  const { client, wrapper } = setup(); fetchMock.mockImplementation(() => Promise.resolve(respond([])))
  const { result } = renderHook(() => ({ query: useRegions({ administrativeLevel: 'DISTRICT' }), mode: useDataMode() }), { wrapper })
  await waitFor(() => { expect(result.current.query.isSuccess).toBe(true) })
  expect(client.getQueryData(['command', 'regions', 'REFERENCE', { administrativeLevel: 'DISTRICT' }])).toEqual([])
  act(() => { result.current.mode.setDataMode('SIMULATION') })
  await waitFor(() => { expect(result.current.query.isSuccess).toBe(true) })
  expect(client.getQueryData(['command', 'regions', 'SIMULATION', { administrativeLevel: 'DISTRICT' }])).toEqual([])
  expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
    '/api/command/regions?administrativeLevel=DISTRICT&dataMode=REFERENCE&limit=200&offset=0',
    '/api/command/regions?administrativeLevel=DISTRICT&dataMode=SIMULATION&limit=200&offset=0',
  ])
})
test.each([
  [() => useRegion('region-1'), '/api/command/regions/region-1?dataMode=REFERENCE', {}],
  [() => useSafeHouses(), '/api/command/safe-houses?dataMode=REFERENCE&limit=200&offset=0', []],
  [() => useMockDisasters(), '/api/command/mock-disasters?dataMode=REFERENCE', []],
  [() => useReports({ offset: 50 }), '/api/command/operations/reports?limit=50&offset=50', []],
  [() => useAssistance({ offset: 100 }), '/api/command/operations/assistance?limit=50&offset=100', []],
  [() => useRoutes({ offset: 150 }), '/api/command/operations/routes?limit=50&offset=150', []],
  [() => useCheckIns(), '/api/command/operations/check-ins', { scope: 'scope', regions: [] }],
])('query emits the legacy URL %s', async (hook, url, body) => {
  const { wrapper } = setup(); fetchMock.mockResolvedValue(respond(body))
  const { result } = renderHook(() => hook().isSuccess, { wrapper })
  await waitFor(() => { expect(result.current).toBe(true) })
  expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
})

const review = { note: 'Reviewed', expectedUpdatedAt: '2026-10-13T00:00:00Z', barrier: false, radiusM: 30, validUntil: null }
const caseBody = { status: 'DISPATCHED' as const, note: 'Dispatch', expectedUpdatedAt: null, assignedRouteId: 'route-1' }
const routeBody = { id: 'route-1', name: 'Route', regionId: 'region-1', shelterId: 'shelter-1', originLatitude: -6.2, originLongitude: 106.8, mobilityRequired: true }
const houseBody = { id: 'house-1', name: 'House', latitude: -6.2, longitude: 106.8, address: null, status: 'UNKNOWN' as const, capacity: null, wheelchairAccessible: null, verifiedNow: false }
const mockBody = { id: 'mock-1', name: 'Flood', hazardType: 'FLOOD' as const, latitude: -6.2, longitude: 106.8, radiusM: 500, severity: 'WATCH' as const }

test.each([
  ['confirm', useConfirmReport, { id: 'report-1', ...review }, 'reports', 'PATCH', 'operations/reports/report-1', { status: 'CONFIRMED', ...review }],
  ['reject', useRejectReport, { id: 'report-1', ...review }, 'reports', 'PATCH', 'operations/reports/report-1', { status: 'REJECTED', ...review }],
  ['resolve', useResolveReport, { id: 'report-1', ...review }, 'reports', 'PATCH', 'operations/reports/report-1', { status: 'RESOLVED', ...review }],
  ['update assistance', useUpdateAssistance, { requestId: 'case-1', ...caseBody }, 'assistance', 'PATCH', 'operations/assistance/case-1', caseBody],
  ['create route', useCreateRoute, routeBody, 'routes', 'POST', 'operations/routes', routeBody],
  ['publish/revalidate', usePublishRoute, 'route-1', 'routes', 'POST', 'operations/routes/route-1/publish', undefined],
  ['withdraw', useWithdrawRoute, 'route-1', 'routes', 'POST', 'operations/routes/route-1/withdraw', undefined],
  ['create safe house', useCreateSafeHouse, houseBody, 'safe-houses', 'POST', 'safe-houses', houseBody],
  ['create mock', useCreateMockDisaster, mockBody, 'mock-disasters', 'POST', 'mock-disasters', mockBody],
  ['clear mocks', useClearMockDisasters, undefined, 'mock-disasters', 'DELETE', 'mock-disasters', undefined],
  ['delete mock', useDeleteMockDisaster, 'mock-1', 'mock-disasters', 'DELETE', 'mock-disasters/mock-1', undefined],
] as const)('%s uses the correct method, body and resource invalidation', async (_name, hook, input, resource, method, path, body) => {
  const { client, wrapper } = setup(); fetchMock.mockResolvedValue(respond({}))
  for (const key of ['regions', 'reports', 'assistance', 'routes', 'safe-houses', 'mock-disasters']) client.setQueryData(['command', key, 'existing'], [])
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(() => hook(), { wrapper })
  await act(async () => { await (result.current.mutateAsync as (value: typeof input) => Promise<unknown>)(input) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] ?? []
  expect(url).toBe('/api/command/' + path)
  expect(init?.method).toBe(method)
  expect(init?.body === undefined ? undefined : JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown).toEqual(body)
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['command', resource] })
  expect(client.getQueryState(['command', resource, 'existing'])?.isInvalidated).toBe(true)
  expect(client.getQueryState(['command', 'regions', 'existing'])?.isInvalidated).toBe(false)
})

test.each([
  [[], 'Connected · no regions in this scope'],
  [[{ snapshotStale: true }], 'Connected · regional snapshots unavailable'],
  [[{ snapshotStale: false }, { snapshotStale: true }], 'Connected · 2 regions · 1 stale'],
])('connection status derives the exact legacy text', async (rows, text) => {
  const { wrapper } = setup()
  fetchMock.mockImplementation((url) => Promise.resolve(respond(requestUrl(url).includes('/regions?') ? rows : [])))
  const { result } = renderHook(() => useConnectionStatus(), { wrapper })
  expect(result.current.text).toBe('Loading dashboard')
  await waitFor(() => { expect(result.current).toMatchObject({ text, tone: 'connected' }) })
})
test('connection status reports a failed overlay load', async () => {
  const { wrapper } = setup()
  fetchMock.mockImplementation((url) => Promise.resolve(requestUrl(url).includes('safe-houses') ? respond({}, 503) : respond([])))
  const { result } = renderHook(() => useConnectionStatus(), { wrapper })
  await waitFor(() => { expect(result.current).toMatchObject({ text: 'Connection unavailable', tone: 'error' }) })
})

test('header refresh invalidates all command data and keeps identical status text unchanged', async () => {
  const { client, wrapper } = setup()
  fetchMock.mockImplementation(() => Promise.resolve(respond([])))
  client.setQueryData(['command', 'reports'], [])
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const view = render(createElement(CommandHeaderActions), { wrapper })
  const status = screen.getByRole('status')
  expect(status).toHaveAttribute('aria-live', 'polite')
  await waitFor(() => { expect(status).toHaveTextContent('Connected · no regions in this scope') })
  const changes = vi.fn()
  const observer = new MutationObserver(changes)
  observer.observe(status, { childList: true, characterData: true, subtree: true })
  view.rerender(createElement(CommandHeaderActions))
  await act(async () => { await Promise.resolve() })
  expect(changes).not.toHaveBeenCalled()
  observer.disconnect()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['command'] })
  expect(client.getQueryState(['command', 'reports'])?.isInvalidated).toBe(true)
})

test('safe houses load all 200-row pages', async () => {
  const { wrapper } = setup()
  const first = Array.from({ length: 200 }, (_, id) => ({ id: String(id) }))
  fetchMock.mockResolvedValueOnce(respond(first)).mockResolvedValueOnce(respond([{ id: 'last' }]))
  const { result } = renderHook(() => useSafeHouses(), { wrapper })
  await waitFor(() => { expect(result.current.data).toHaveLength(201) })
  expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
    '/api/command/safe-houses?dataMode=REFERENCE&limit=200&offset=0',
    '/api/command/safe-houses?dataMode=REFERENCE&limit=200&offset=200',
  ])
})
test('assistance KPI pages in 50s and excludes completed/cancelled cases', async () => {
  const { wrapper } = setup()
  const item = { requestId: 'case-1', status: 'REQUESTED', supportNeeds: [], requestedAt: '2026-10-13T00:00:00Z', observedAt: '2026-10-13T00:00:00Z', stale: false, government: null, caseUpdatedAt: null }
  fetchMock.mockResolvedValueOnce(respond(Array.from({ length: 50 }, () => item))).mockResolvedValueOnce(respond([
    { ...item, stale: true },
    { ...item, government: { status: 'COMPLETED', note: 'Done', assignedRouteId: null } },
    { ...item, government: { status: 'CANCELLED', note: 'Cancelled', assignedRouteId: null } },
  ]))
  const { result } = renderHook(() => useAssistanceCounts(), { wrapper })
  await waitFor(() => { expect(result.current.data).toEqual({ open: 50, stale: 1 }) })
  expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
    '/api/command/operations/assistance?limit=50&offset=0',
    '/api/command/operations/assistance?limit=50&offset=50',
  ])
})
