import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMap } from '@/map/MapProvider'
import { circlePolygon } from '@/map/glMap'
import { useMockDisasters, useSafeHouses, useCreateMockDisaster, useCreateSafeHouse, useClearMockDisasters, useDeleteMockDisaster } from '@/lib/queries'
import type { MockDisasterCreate, SafeHouseCreate } from '@/lib/types'
import { Switch } from '@/components/base/switch/switch'
import { Button } from '@/components/base/buttons/button'
import { CloseButton } from '@/components/base/buttons/close-button'
import { DataState } from './RegionPanel'
import { loadMocks, saveMocks, storageKey, type MockItem } from './mockStore'
import { useMockMode, setMockMode } from '@/features/routes/formState'
import { SafeHouseDialog, type Draft } from './SafeHouseDialog'

const reach = (count: number | null | undefined) => count === undefined ? '' : count === null ? 'under 5 users in area' : count.toLocaleString('en-US') + ' users in area'
const word = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
const label = (item: MockItem & { usersInArea?: number | null }) => (item.kind === 'hazard' ? 'Simulation · ' : 'Mock · ') + item.name + (item.kind === 'hazard' ? ' · ' + word(item.hazardType) + ' · ' + word(item.severity) + (reach(item.usersInArea) && ' · ' + reach(item.usersInArea)) : ' · Safe house')

export function MockMode({ filters, layers, refresh, onBusyChange, children }: { filters: ReactNode; layers: ReactNode; refresh: () => Promise<unknown>; onBusyChange: (busy: boolean) => void; children?: ReactNode }) {
  const map = useMap()
  const mocks = useMockDisasters()
  const houses = useSafeHouses()
  const createMock = useCreateMockDisaster()
  const createHouse = useCreateSafeHouse()
  const clear = useClearMockDisasters()
  const remove = useDeleteMockDisaster()
  const mock = useMockMode()
  const [items, setItems] = useState(() => loadMocks().filter(item => item.kind === 'safeHouse'))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [placing, setPlacing] = useState(false)
  const [status, setStatus] = useState(() => {
    try { JSON.parse(localStorage.getItem(storageKey) || '[]'); return '' }
    catch { return 'Saved mock items could not be loaded. You can start a new mock scenario.' }
  })
  const loadError = (houses.error || mocks.error)?.message
  const generation = useRef(0)
  const pending = createMock.isPending || createHouse.isPending || clear.isPending || remove.isPending
  useEffect(() => { onBusyChange(placing || Boolean(draft) || pending); return () => { onBusyChange(false); } }, [placing, draft, pending, onBusyChange])
  useEffect(() => { try { if (items.length || localStorage.getItem(storageKey) !== null) saveMocks(items) } catch { queueMicrotask(() => { setStatus('Browser storage unavailable. Mock items remain available for this tab only.') }) } }, [items])
  const picking = useRef<(() => void) | null>(null)
  useEffect(() => () => { generation.current++; picking.current?.() }, [])
  const all = useMemo(() => [...(mocks.data ?? []).map(item => ({ ...item, kind: 'hazard' as const })), ...(mock ? items : [])], [mocks.data, items, mock])
  useEffect(() => {
    if (!map) return
    map.setLayer('mock', { type: 'FeatureCollection', features: all.map(item => ({ type: 'Feature', id: item.id, geometry: item.kind === 'hazard' ? circlePolygon(item.longitude, item.latitude, item.radiusM) : { type: 'Point', coordinates: [item.longitude, item.latitude] }, properties: { color: '#9D4AC1', weight: 3, dashed: item.kind === 'hazard', radius: 9, fillColor: item.kind === 'safeHouse' ? getComputedStyle(document.documentElement).getPropertyValue('--color-surface-100').trim() || '#FFFFFF' : '#9D4AC1', fillOpacity: item.kind === 'hazard' ? .18 : 1, tooltip: label(item) } })) })
  }, [map, all])
  useEffect(() => {
    map?.setLayer('safe-house', { type: 'FeatureCollection', features: (houses.data ?? []).map(house => ({ type: 'Feature', id: house.id, geometry: { type: 'Point', coordinates: [house.longitude, house.latitude] }, properties: { radius: 8, color: '#176D60', fillColor: getComputedStyle(document.documentElement).getPropertyValue('--color-surface-100').trim() || '#FFFFFF', fillOpacity: 1, weight: 3, tooltip: house.name + ' · Safe house · ' + house.status } })) })
  }, [map, houses.data])
  function cancel() {
    generation.current++
    picking.current?.()
    picking.current = null
    setPlacing(false)
    setStatus('')
  }
  async function begin(kind: Draft['kind']) {
    cancel()
    const version = generation.current
    if (!map) { setDraft({ id: crypto.randomUUID(), kind, mock }); return }
    setPlacing(true)
    setStatus('Click the map to place ' + (kind === 'hazard' ? 'a mock disaster.' : 'a safe house.'))
    try {
      const picked = map.pick()
      picking.current = () => { map.cancelPick() }
      const [longitude, latitude] = await picked
      picking.current = null
      if (generation.current !== version) return
      setPlacing(false)
      setStatus('')
      setDraft({ id: crypto.randomUUID(), kind, mock, latitude, longitude })
    } catch (error) { if (generation.current === version) { setPlacing(false); setStatus((error as Error).name === 'AbortError' ? '' : (error as Error).message) } }
  }
  const message = placing ? '' : status || loadError
  const fitTo = (item: MockItem) => map?.fit([[item.longitude - .005, item.latitude - .005], [item.longitude + .005, item.latitude + .005]])
  const itemList = <ul aria-label="Mock items" className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">{all.map(item => <li key={item.id} className={'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full pe-1 ps-2.5 text-status-purple-text ' + (mock ? 'bg-background-primary-default shadow-xs' : 'bg-status-purple-background')}>
    <span aria-hidden className={'size-2 shrink-0 rounded-full border-[1.5px] border-[#9D4AC1] ' + (item.kind === 'hazard' ? 'border-dashed bg-[#9D4AC1]/20' : 'bg-background-primary-default')} />
    <button type="button" className="min-w-0 cursor-pointer truncate rounded-sm text-caption-1-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring" onClick={() => fitTo(item)}>{label(item)}</button>
    <CloseButton aria-label={'Remove ' + item.name} disabled={pending} size="2xs" onClick={() => { void (async () => { try { if (item.kind === 'hazard') await remove.mutateAsync(item.id); else setItems(current => current.filter(value => value.id !== item.id)); await refresh() } catch (error) { setStatus((error as Error).message) } })() }} />
  </li>)}</ul>
  return <>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 pb-3">
      <div className="grid min-w-0 flex-[1_1_520px] grid-cols-2 gap-2 sm:grid-cols-4 xl:max-w-[760px]">{filters}</div>
      <Switch size="md" isSelected={mock} onChange={value => { cancel(); setMockMode(value); setStatus('') }}>Mock mode</Switch>
    </div>
    {mock
      ? <div className="mx-3 mb-3 flex flex-col gap-2.5 rounded-xl bg-status-purple-background px-3 py-2.5 text-status-purple-text">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="min-w-0 flex-1 basis-64 text-body-2-regular text-pretty">Test data only. Elevated and Critical mocks can send test pushes.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" disabled={pending} onClick={() => { void begin('hazard') }}>Add mock disaster</Button>
              <Button size="small" variant="secondary" disabled={pending} onClick={() => { void begin('safeHouse') }}>Add mock safe house</Button>
              {all.length > 0 && <Button size="small" variant="ghost" className="bg-transparent text-status-purple-text hover:bg-background-primary-default/60" disabled={pending} onClick={() => { void (async () => { try { await clear.mutateAsync(); setItems([]); cancel(); await refresh() } catch (error) { setStatus((error as Error).message) } })() }}>Clear mock items</Button>}
            </div>
          </div>
          {all.length > 0 && <DataState loading={mocks.isPending}>{itemList}</DataState>}
        </div>
      : Boolean(mocks.data?.length) && <div className="mx-3 mb-3">{itemList}</div>}
    {message && <p role="status" className="mx-3 mb-3 text-body-2-regular text-text-secondary-strong">{message}</p>}
    <div className="relative overflow-hidden rounded-xl border border-border-button-default bg-background-inner-default dark:border-border-button-white">
      {children}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-end">
        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          {!mock && <Button size="small" variant="secondary" disabled={pending} onClick={() => { void begin('safeHouse') }}>Add safe house</Button>}
          {layers}
        </div>
      </div>
      {placing && <div className="absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-background-primary-default py-1 pe-1 ps-3.5 shadow-sidebar">
        <p role="status" className="text-body-2-medium text-text-primary">{status}</p>
        <Button size="xs" variant="secondary" className="rounded-full" onClick={cancel}>Cancel placement</Button>
      </div>}
    </div>
    {draft && <SafeHouseDialog key={draft.id} draft={draft} onClose={() => { setDraft(null); }} onSave={async payload => {
      if (draft.kind === 'hazard') {
        const result = await createMock.mutateAsync(payload as MockDisasterCreate)
        await refresh()
        setStatus(payload.name + ' placed. ' + (result.usersInArea === null ? 'Fewer than 5 recently located EvacuAid users are in the area, so the exact count is hidden. ' : result.usersInArea.toLocaleString('en-US') + ' recently located EvacuAid users are in the area. ') + ((payload as MockDisasterCreate).severity === 'WATCH' ? 'Watch warnings appear in the app without a push notification.' : 'Test push notifications depend on alert delivery being enabled and a registered device. Delivery is not confirmed here.'))
      } else if (draft.mock) {
        if (items.length >= 200) throw new Error('Remove an existing mock item before adding more (limit 200).')
        setItems(current => [...current, { ...payload as SafeHouseCreate, kind: 'safeHouse' }])
        map?.fit([[payload.longitude - .005, payload.latitude - .005], [payload.longitude + .005, payload.latitude + .005]])
        setStatus(payload.name + ' saved in this browser only. Live data unchanged.')
      } else {
        await createHouse.mutateAsync(payload)
        await refresh()
        setStatus(payload.name + ' saved to the backend. Regional shelter projections refreshed.')
      }
    }} />}
  </>
}
