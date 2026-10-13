import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMap } from '@/map/MapProvider'
import { circlePolygon } from '@/map/glMap'
import { useMockDisasters, useSafeHouses, useCreateMockDisaster, useCreateSafeHouse, useClearMockDisasters, useDeleteMockDisaster } from '@/lib/queries'
import type { MockDisasterCreate, SafeHouseCreate } from '@/lib/types'
import { Switch } from '@/components/base/switch/switch'
import { Button } from '@/components/base/buttons/button'
import { CloseButton } from '@/components/base/buttons/close-button'
import { Chip } from '@/components/base/badges/chip'
import { Alert } from '@/components/app/primitives/alert'
import { Card, CardContent } from '@/components/app/primitives/card'
import { DataState } from './RegionPanel'
import { loadMocks, saveMocks, storageKey, type MockItem } from './mockStore'
import { SafeHouseDialog, type Draft } from './SafeHouseDialog'

export function MockMode({ filters, layers, refresh, onBusyChange }: { filters: ReactNode; layers: ReactNode; refresh: () => Promise<unknown>; onBusyChange: (busy: boolean) => void }) {
  const map = useMap()
  const mocks = useMockDisasters()
  const houses = useSafeHouses()
  const createMock = useCreateMockDisaster()
  const createHouse = useCreateSafeHouse()
  const clear = useClearMockDisasters()
  const remove = useDeleteMockDisaster()
  const [mock, setMock] = useState(false)
  const [items, setItems] = useState(() => loadMocks().filter(item => item.kind === 'safeHouse'))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [placing, setPlacing] = useState(false)
  const [status, setStatus] = useState(() => {
    try { JSON.parse(localStorage.getItem(storageKey) || '[]'); return '' }
    catch { return 'Saved mock items could not be loaded. You can start a new mock scenario.' }
  })
  const loadError = (houses.error || mocks.error)?.message
  const toolbar = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  useEffect(() => {
    const node = toolbar.current
    if (!node) return
    const update = () => node.parentElement?.style.setProperty('--overview-tools-height', String(node.offsetHeight) + 'px')
    const observer = new ResizeObserver(update)
    observer.observe(node); update()
    return () => { observer.disconnect(); }
  }, [])
  const pending = createMock.isPending || createHouse.isPending || clear.isPending || remove.isPending
  useEffect(() => { onBusyChange(placing || Boolean(draft) || pending); return () => { onBusyChange(false); } }, [placing, draft, pending, onBusyChange])
  useEffect(() => { try { if (items.length || localStorage.getItem(storageKey) !== null) saveMocks(items) } catch { queueMicrotask(() => { setStatus('Browser storage unavailable. Mock items remain available for this tab only.') }) } }, [items])
  const picking = useRef<(() => void) | null>(null)
  useEffect(() => () => { generation.current++; picking.current?.() }, [])
  const reach = (count: number | null | undefined) => count === undefined ? '' : count === null ? 'under 5 users in area' : count.toLocaleString('en-US') + ' users in area'
  const word = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
  const all = [...(mocks.data ?? []).map(item => ({ ...item, kind: 'hazard' as const })), ...(mock ? items : [])]
  const label = (item: MockItem & { usersInArea?: number | null }) => (item.kind === 'hazard' ? 'Simulation · ' : 'Mock · ') + item.name + (item.kind === 'hazard' ? ' · ' + word(item.hazardType) + ' · ' + word(item.severity) + (reach(item.usersInArea) && ' · ' + reach(item.usersInArea)) : ' · Safe house')
  useEffect(() => {
    if (!map) return
    map.setLayer('mock', { type: 'FeatureCollection', features: all.map(item => ({ type: 'Feature', id: item.id, geometry: item.kind === 'hazard' ? circlePolygon(item.longitude, item.latitude, item.radiusM) : { type: 'Point', coordinates: [item.longitude, item.latitude] }, properties: { color: '#9D4AC1', weight: 3, dashed: item.kind === 'hazard', radius: 9, fillColor: item.kind === 'safeHouse' ? getComputedStyle(document.documentElement).getPropertyValue('--color-surface-100').trim() || '#FFFFFF' : '#9D4AC1', fillOpacity: item.kind === 'hazard' ? .18 : 1, tooltip: label(item) } })) })
  })
  useEffect(() => {
    map?.setLayer('safe-house', { type: 'FeatureCollection', features: (houses.data ?? []).map(house => ({ type: 'Feature', id: house.id, geometry: { type: 'Point', coordinates: [house.longitude, house.latitude] }, properties: { radius: 8, color: '#176D60', fillColor: getComputedStyle(document.documentElement).getPropertyValue('--color-surface-100').trim() || '#FFFFFF', fillOpacity: 1, weight: 3, tooltip: house.name + ' · Safe house · ' + house.status } })) })
  }, [map, houses.data])
  function cancel() {
    generation.current++
    picking.current?.()
    picking.current = null
    setPlacing(false)
    setStatus(mock ? 'MOCK MODE · Choose a tool, then click the map. Live region statistics remain unchanged.' : '')
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
      setStatus(mock ? 'MOCK MODE · Choose a tool, then click the map. Live region statistics remain unchanged.' : '')
      setDraft({ id: crypto.randomUUID(), kind, mock, latitude, longitude })
    } catch (error) { if (generation.current === version) { setPlacing(false); setStatus((error as Error).name === 'AbortError' ? mock ? 'MOCK MODE · Choose a tool, then click the map. Live region statistics remain unchanged.' : '' : (error as Error).message) } }
  }
  return <>
    <div ref={toolbar} className="absolute inset-x-3 top-3 z-20 flex max-h-[calc(100%-24px)] flex-col gap-2 overflow-auto">
      {mock && <Alert>MOCK MODE · Mock disasters are saved as test warnings: Watch appears in the app; Elevated and Critical can send test push notifications when alert delivery is enabled. Mock safe houses stay in this browser. Official data is unchanged.</Alert>}
      <Card size="sm"><CardContent className="flex flex-col gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{filters}</div><div className="flex flex-wrap items-center gap-2"><Switch size="sm" isSelected={mock} onChange={value => { cancel(); setMock(value); setStatus(value ? 'MOCK MODE · Choose a tool, then click the map. Live region statistics remain unchanged.' : '') }}>Mock mode</Switch><Button disabled={!mock || pending} onClick={() => { void begin('hazard') }}>Add mock disaster</Button>{placing && <Button variant="secondary" onClick={cancel}>Cancel placement</Button>}{mock && <Button variant="secondary" disabled={pending} onClick={() => { void (async () => { try { await clear.mutateAsync(); setItems([]); cancel(); await refresh() } catch (error) { setStatus((error as Error).message) } })() }}>Clear mock items</Button>}</div></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={pending} onClick={() => { void begin('safeHouse') }}>{mock ? 'Add mock safe house' : 'Add safe house'}</Button>{layers}</div></CardContent></Card>
      {(status || loadError) && <Card size="sm"><CardContent><p role="status">{status || loadError}</p></CardContent></Card>}
      {(mock || Boolean(mocks.data?.length)) && <DataState loading={mocks.isPending}><Card size="sm"><CardContent className="flex max-h-32 flex-wrap gap-2 overflow-auto">{all.map(item => <Chip key={item.id} variant="caption"><Button variant="ghost" size="small" onClick={() => map?.fit([[item.longitude - .005, item.latitude - .005], [item.longitude + .005, item.latitude + .005]])}>{label(item)}</Button><CloseButton aria-label={'Remove ' + item.name} disabled={pending} size="sm" onClick={() => { void (async () => { try { if (item.kind === 'hazard') await remove.mutateAsync(item.id); else setItems(current => current.filter(value => value.id !== item.id)); await refresh() } catch (error) { setStatus((error as Error).message) } })() }} /></Chip>)}{!all.length && <p>No mock items. Choose Add mock disaster or Add safe house, then click the map.</p>}</CardContent></Card></DataState>}
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
