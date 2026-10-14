import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataMode } from '@/app/data-mode'
import { api, allRegions } from './api'
import type { AssistanceCase, CaseUpdate, CaseUpdateResponse, CheckIns, FieldReport, MockDisaster, MockDisasterCreate, OperationalRoute, PagingParams, RegionDetail, RegionParams, Review, RouteSet, SafeHouse, SafeHouseCreate } from './types'

const defaultRegionParams: RegionParams = { administrativeLevel: 'VILLAGE' }

export function useRegions(params: RegionParams = defaultRegionParams) {
  const { dataMode } = useDataMode()
  return useQuery({ queryKey: ['command', 'regions', dataMode, params], queryFn: () => allRegions({ ...params, dataMode }) })
}

export function useRegion(id: string | null) {
  const { dataMode } = useDataMode()
  return useQuery({ queryKey: ['command', 'region', dataMode, id], enabled: id !== null, queryFn: () => api<RegionDetail>('regions/' + encodeURIComponent(id ?? '') + '?' + new URLSearchParams({ dataMode }).toString()) })
}

export function useSafeHouses() {
  const { dataMode } = useDataMode()
  return useQuery({ queryKey: ['command', 'safe-houses', dataMode], queryFn: async () => {
    const rows: SafeHouse[] = []
    for (let offset = 0; ; offset += 200) {
      const batch = await api<SafeHouse[]>('safe-houses?' + new URLSearchParams({ dataMode, limit: '200', offset: String(offset) }).toString())
      rows.push(...batch)
      if (batch.length < 200) return rows
    }
  } })
}

export function useMockDisasters() {
  const { dataMode } = useDataMode()
  return useQuery({ queryKey: ['command', 'mock-disasters', dataMode], queryFn: () => api<MockDisaster[]>('mock-disasters?' + new URLSearchParams({ dataMode }).toString()) })
}

function useOperations<T>(resource: string, params?: PagingParams, refetchOnMount = true) {
  const { dataMode } = useDataMode()
  const paging = params ? { limit: params.limit ?? 50, offset: params.offset ?? 0 } : undefined
  return useQuery({ queryKey: paging ? ['command', resource, paging] : ['command', resource], enabled: dataMode === 'REFERENCE', refetchOnMount, queryFn: () => api<T>('operations/' + resource + (paging ? '?' + new URLSearchParams({ limit: String(paging.limit), offset: String(paging.offset) }).toString() : '')), refetchInterval: 15_000, refetchIntervalInBackground: false })
}

export function useReports(params: PagingParams = {}) { return useOperations<FieldReport[]>('reports', params) }
export function useAssistance(params: PagingParams = {}) { return useOperations<AssistanceCase[]>('assistance', params) }
export function useCheckIns() { return useOperations<CheckIns>('check-ins') }
export function useRoutes(params: PagingParams = {}, refetchOnMount = true) { return useOperations<OperationalRoute[]>('routes', params, refetchOnMount) }

export function useAssistanceCounts(refetchOnMount = true) {
  const { dataMode } = useDataMode()
  return useQuery({ queryKey: ['command', 'assistance', 'counts'], refetchOnMount, enabled: dataMode === 'REFERENCE', queryFn: async () => {
    let open = 0
    let stale = 0
    for (let offset = 0; ; offset += 50) {
      const batch = await api<AssistanceCase[]>('operations/assistance?limit=50&offset=' + String(offset))
      for (const item of batch) {
        if (item.government && ['COMPLETED', 'CANCELLED'].includes(item.government.status)) continue
        if (item.stale) stale++
        else open++
      }
      if (batch.length < 50) return { open, stale }
    }
  } })
}

function useCommandMutation<T, V>(resource: string, mutationFn: (value: V) => Promise<T>) {
  const client = useQueryClient()
  // onSettled: a failed publish can still save the route as DRAFT, so refresh after errors too.
  return useMutation({ mutationFn, onSettled: () => Promise.all([
    client.invalidateQueries({ queryKey: ['command', resource] }),
    // Any report review demotes every published route to DRAFT on the backend.
    ...(resource === 'reports' ? [client.invalidateQueries({ queryKey: ['command', 'routes'] })] : []),
    ...(resource === 'safe-houses' || resource === 'mock-disasters' ? [
      client.invalidateQueries({ queryKey: ['command', 'regions'] }),
      client.invalidateQueries({ queryKey: ['command', 'region'] }),
    ] : []),
  ]) })
}

type ReviewInput = Omit<Review, 'status'> & { id: string }
function useReviewReport(status: Review['status']) {
  return useCommandMutation('reports', ({ id, ...body }: ReviewInput) => api<FieldReport>('operations/reports/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status, ...body }) }))
}
export function useConfirmReport() { return useReviewReport('CONFIRMED') }
export function useRejectReport() { return useReviewReport('REJECTED') }
export function useResolveReport() { return useReviewReport('RESOLVED') }
export function useUpdateAssistance() {
  return useCommandMutation('assistance', ({ requestId, ...body }: CaseUpdate & { requestId: string }) => api<CaseUpdateResponse>('operations/assistance/' + encodeURIComponent(requestId), { method: 'PATCH', body: JSON.stringify(body) }))
}
export function useCreateRoute() {
  return useCommandMutation('routes', (body: RouteSet) => api<OperationalRoute>('operations/routes', { method: 'POST', body: JSON.stringify(body) }))
}
export function usePublishRoute() {
  return useCommandMutation('routes', (id: string) => api<OperationalRoute>('operations/routes/' + encodeURIComponent(id) + '/publish', { method: 'POST' }))
}
export function useWithdrawRoute() {
  return useCommandMutation('routes', (id: string) => api<OperationalRoute>('operations/routes/' + encodeURIComponent(id) + '/withdraw', { method: 'POST' }))
}
export function useCreateSafeHouse() {
  return useCommandMutation('safe-houses', (body: SafeHouseCreate) => api<SafeHouse>('safe-houses', { method: 'POST', body: JSON.stringify(body) }))
}
export function useCreateMockDisaster() {
  return useCommandMutation('mock-disasters', (body: MockDisasterCreate) => api<MockDisaster>('mock-disasters', { method: 'POST', body: JSON.stringify(body) }))
}
export function useClearMockDisasters() {
  return useCommandMutation('mock-disasters', () => api<null>('mock-disasters', { method: 'DELETE' }))
}
export function useDeleteMockDisaster() {
  return useCommandMutation('mock-disasters', (id: string) => api<null>('mock-disasters/' + encodeURIComponent(id), { method: 'DELETE' }))
}

export function operationsConnectionError(error: Error): string {
  return 'Connection unavailable · retained data may be stale. ' + error.message
}

export function useConnectionStatus(params: RegionParams = defaultRegionParams): { text: string; tone: 'loading' | 'connected' | 'error'; error?: Error } {
  const client = useQueryClient()
  const regions = useRegions(params)
  const houses = useSafeHouses()
  const mocks = useMockDisasters()
  const queries = [regions, houses, mocks]
  if (queries.some(query => query.isPending || query.isFetching)) {
    const hasData = client.getQueriesData({ queryKey: ['command', 'regions'] }).some(([, data]) => data !== undefined)
    return { text: hasData ? 'Loading projections…' : 'Loading dashboard', tone: 'loading' }
  }
  const error = queries.find(query => query.isError)?.error
  if (error) return { text: 'Connection unavailable', tone: 'error', error }
  const rows = regions.data ?? []
  const stale = rows.filter(region => region.snapshotStale).length
  return { text: !rows.length ? 'Connected · no regions in this scope' : stale === rows.length ? 'Connected · regional snapshots unavailable' : 'Connected · ' + String(rows.length) + ' regions · ' + String(stale) + ' stale', tone: 'connected' }
}
