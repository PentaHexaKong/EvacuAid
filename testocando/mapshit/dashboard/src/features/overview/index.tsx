import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AdministrativeLevel, HazardType, SignalLevel, Geometry, Region } from '@/lib/types'
import { useAssistanceCounts, useRegion, useRegions, useRoutes } from '@/lib/queries'
import { useDataMode } from '@/app/data-mode'
import { MapView } from '@/map/MapView'
import { useMap } from '@/map/MapProvider'
import { boundsOf, type Feature, type FeatureStyle } from '@/map/glMap'
import { Card, CardContent, CardTitle } from '@/components/app/primitives/card'
import { Alert } from '@/components/app/primitives/alert'
import { Button } from '@/components/base/buttons/button'
import { CloseButton } from '@/components/base/buttons/close-button'
import { Select, SelectItem } from '@/components/base/select/select'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/base/popover/popover'
import { Kpis } from './Kpis'
import { orderedRegions, PriorityRegions } from './PriorityRegions'
import { RegionPanel, severity, Signal, titleCase, readable, Metrics, groupHazards, hazardName, hazardKind, sourceName, provenanceName, time } from './RegionPanel'
import { Shelters } from './Shelters'
import { Needs } from './Needs'
import { Sources } from './Sources'
import { MockMode } from './MockMode'
import { hazardTypes } from './SafeHouseDialog'

const layerLabels = { regions: 'Regional status', active: 'Official active', baseline: 'Baseline susceptibility', community: 'Community observations', satellite: 'Satellite observations', shelters: 'Shelters', routes: 'Published evacuation routes' }
const emptyRegions: Region[] = []
const parentLevels: Partial<Record<AdministrativeLevel, AdministrativeLevel>> = { VILLAGE: 'DISTRICT', DISTRICT: 'CITY_REGENCY', CITY_REGENCY: 'PROVINCE' }
function feature(geometry: Geometry | null, properties: FeatureStyle & { tooltip?: string; regionId?: string }): Feature { return { type: 'Feature', geometry, properties } }
function geography(rows: Region[]) {
  const located = rows.filter(r => r.centroid.type === 'Point' && (r.centroid.coordinates?.length ?? 0) >= 2)
  const median = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 }
  const latitude = median(located.map(r => (r.centroid.coordinates as [number, number])[1]))
  const longitude = median(located.map(r => (r.centroid.coordinates as [number, number])[0]))
  const mainland = located.filter(r => Math.abs((r.centroid.coordinates as [number, number])[1] - latitude) <= .25 && Math.abs((r.centroid.coordinates as [number, number])[0] - longitude) <= .25)
  return { located, mainland, offshore: new Set(located.filter(r => !mainland.includes(r)).map(r => r.id)) }
}

export default function Page() {
  const { dataMode } = useDataMode()
  const map = useMap()
  const client = useQueryClient()
  const [level, setLevel] = useState<AdministrativeLevel>('VILLAGE')
  const [parent, setParent] = useState('')
  const [filterMode, setFilterMode] = useState(dataMode)
  if (filterMode !== dataMode) { setFilterMode(dataMode); setParent('') }
  const [hazard, setHazard] = useState('')
  const [signal, setSignal] = useState('')
  const [selection, setSelection] = useState<{ scope: string; id: string | null; updatedAt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState({ regions: true, active: true, baseline: false, community: false, satellite: false, shelters: true, routes: true })
  const params = useMemo(() => ({ administrativeLevel: level, ...(parent ? { parentRegionId: parent } : {}), ...(hazard ? { hazardType: hazard as HazardType } : {}), ...(signal ? { signalLevel: signal as SignalLevel } : {}) }), [level, parent, hazard, signal])
  const scope = JSON.stringify([dataMode, params])
  const regions = useRegions(params)
  const parents = useRegions({ administrativeLevel: parentLevels[level] ?? 'PROVINCE' })
  const cases = useAssistanceCounts()
  const routes = useRoutes()
  const rows = regions.data ?? emptyRegions
  const selected = selection?.scope === scope && ((selection.id === null && selection.updatedAt === regions.dataUpdatedAt) || rows.some(r => r.id === selection.id)) ? selection.id : rows[0]?.id ?? null
  const region = useRegion(selected)
  const detail = region.data
  const geo = useMemo(() => geography(rows), [rows])
  const hero = useRef<HTMLDivElement>(null)
  const frameScope = useRef<string | null>(null)
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ['command'] }), [client])
  useEffect(() => { document.title = 'Regional overview · EvacuAid Command Center' }, [])
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden && !busy) void refresh() }, 60000)
    return () => { clearInterval(interval); }
  }, [busy, refresh])
  useEffect(() => {
    if (!map || regions.isPending || frameScope.current === scope) return
    frameScope.current = scope
    const geometry: Geometry = { type: 'GeometryCollection', geometries: (geo.mainland.length >= 3 ? geo.mainland : geo.located).map(r => r.geometry) }
    const bounds = boundsOf(geometry)
    if (bounds) map.fit(bounds)
    else if (!rows.length) map.fit([[95, -11], [141, 6]])
  }, [map, scope, geo, rows.length, regions.isPending])
  const select = useCallback((id: string) => {
    setSelection({ scope, id, updatedAt: regions.dataUpdatedAt })
    const bounds = boundsOf(rows.find(r => r.id === id)?.geometry)
    if (map && bounds) map.fit(bounds)
  }, [scope, rows, map, regions.dataUpdatedAt])
  useEffect(() => { if (map) return map.onClick('region', clicked => { if (!busy && typeof clicked.properties?.regionId === 'string') select(clicked.properties.regionId) }) }, [map, busy, select])
  useEffect(() => {
    if (!map) return
    const root = getComputedStyle(document.documentElement)
    const accent = root.getPropertyValue('--color-accent-600').trim() || '#2E54E6'
    const surface = root.getPropertyValue('--color-surface-100').trim() || '#FFFFFF'
    map.setLayer('region', { type: 'FeatureCollection', features: rows.filter(r => !geo.offshore.has(r.id) || r.id === selected || parent || !['VILLAGE', 'DISTRICT'].includes(level)).map(r => {
      const display = r.simulation?.signalLevel || r.signalLevel
      const colors = severity[display]
      const chosen = r.id === selected
      return feature(r.geometry, { regionId: r.id, tooltip: (r.simulation ? 'Simulation · ' : '') + titleCase(r.name) + ' · ' + readable(display), color: chosen || r.simulation ? accent : colors.stroke, weight: chosen ? 2.5 : r.simulation ? 2 : 1, hoverWeight: chosen ? 2.5 : 2, opacity: .9, fillColor: colors.fill, fillOpacity: r.simulation ? .5 : colors.opacity, dashed: Boolean(r.simulation), sortKey: chosen ? 1 : 0 })
    }) })
    map.setVisible('region', visible.regions)
    map.setLayer('hazard', { type: 'FeatureCollection', features: (detail?.hazards ?? []).filter(h => h.active && ['FRESH', 'REFERENCE'].includes(h.freshness) && !detail?.snapshotStale).flatMap(h => {
      const target = h.provenanceClass === 'OFFICIAL_BASELINE' ? 'baseline' : h.provenanceClass === 'COMMUNITY_OBSERVATION' ? 'community' : h.provenanceClass === 'SATELLITE_OBSERVATION' ? 'satellite' : 'active'
      if (!visible[target]) return []
      const baseline = target === 'baseline'
      const point = ['Point', 'MultiPoint'].includes(h.geometry?.type ?? '')
      return [feature(h.geometry, { ...(point ? { radius: 6, weight: 3, color: target === 'community' ? '#277AC0' : '#DC8132', fillOpacity: .6 } : { color: baseline ? '#7A5BA6' : severity.CRITICAL.stroke, weight: 2, dashed: baseline, fillOpacity: baseline ? .06 : .17 }), tooltip: sourceName(h.source) + ' · ' + provenanceName(h.provenanceClass) })]
    }) })
    map.setVisible('hazard', visible.active || visible.baseline || visible.community || visible.satellite)
    map.setLayer('shelter', { type: 'FeatureCollection', features: (detail?.shelters ?? []).map(s => feature(s.geometry, { radius: 6, color: accent, fillColor: surface, fillOpacity: 1, weight: 2, tooltip: s.name + ' · capacity ' + (s.capacity == null ? '—' : s.capacity.toLocaleString('en-US')) })) })
    map.setVisible('shelter', visible.shelters)
    map.setLayer('route', { type: 'FeatureCollection', features: (dataMode === 'REFERENCE' ? routes.data ?? [] : []).filter(r => r.usable && r.result.route?.geometry).map(r => feature(r.result.route?.geometry ?? null, { color: '#176D60', weight: 3, tooltip: r.name + ' · expires ' + time(r.expiresAt) + ' · safety not verified' })) })
    map.setVisible('route', visible.routes)
  }, [map, rows, selected, parent, level, geo, detail, visible, routes.data, dataMode])
  const errors = [regions.error, parents.error, region.error, routes.error].filter(Boolean)
  const stale = rows.filter(r => r.snapshotStale).length
  const explanation = (dataMode === 'SIMULATION' ? 'Simulation data. Synthetic administrative boundaries and population; not real operational statistics. ' : 'Operational data. ') + String(rows.length) + ' regions in the current filter scope. ' + String(stale) + ' unavailable/stale projections. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. ' + (!rows.length ? 'Import administrative GeoJSON using the command importer.' : 'Hazard and shelter overlays load when a region is selected.')
  const layers = <Popover><PopoverTrigger><Button variant="secondary">Layers</Button></PopoverTrigger><PopoverContent align="end">{(Object.keys(layerLabels) as (keyof typeof layerLabels)[]).map(key => <Checkbox key={key} isSelected={visible[key]} onChange={value => { setVisible(current => ({ ...current, [key]: value })); }}>{layerLabels[key]}</Checkbox>)}<p>Hazard and shelter overlays show the selected region. Baseline outlines indicate susceptibility, not an active warning.</p></PopoverContent></Popover>
  const filters = <>
    <Select aria-label="Level" className="w-44" value={level} onChange={key => { setLevel(key as AdministrativeLevel); setParent('') }}><SelectItem id="VILLAGE">Kelurahan / Desa</SelectItem><SelectItem id="DISTRICT">Kecamatan</SelectItem><SelectItem id="CITY_REGENCY">City / Regency</SelectItem><SelectItem id="PROVINCE">Province</SelectItem></Select>
    <Select aria-label="Parent region" className="w-40" value={parent || 'all'} onChange={key => { setParent(key === 'all' ? '' : String(key)); }}><SelectItem id="all">All parents</SelectItem>{parentLevels[level] && (parents.data ?? []).map(r => <SelectItem key={r.id} id={r.id}>{titleCase(r.name)}</SelectItem>)}</Select>
    <Select aria-label="Hazard" className="w-40" value={hazard || 'all'} onChange={key => { setHazard(key === 'all' ? '' : String(key)); }}><SelectItem id="all">All types</SelectItem>{hazardTypes.map(type => <SelectItem id={type} key={type}>{hazardName(type)}</SelectItem>)}</Select>
    <Select aria-label="Signal" className="w-40" value={signal || 'all'} onChange={key => { setSignal(key === 'all' ? '' : String(key)); }}><SelectItem id="all">All signals</SelectItem>{(['CRITICAL', 'ELEVATED', 'WATCH', 'NORMAL', 'UNKNOWN'] as const).map(value => <SelectItem id={value} key={value}>{readable(value)}</SelectItem>)}</Select>
  </>
  const fresh = detail ? groupHazards(detail.hazards).filter(h => h.active && h.freshness === 'FRESH') : []
  function closeCard() { setSelection({ scope, id: null, updatedAt: regions.dataUpdatedAt }); hero.current?.focus({ preventScroll: true }) }
  return <div className="flex flex-col gap-4">
    <h1 className="sr-only">Regional overview</h1>
    {errors.map((error, i) => <Alert key={i} variant="destructive">{error?.message}</Alert>)}
    {!regions.isPending && !regions.error && (dataMode === 'SIMULATION' || !rows.length) && <Alert role="status">{explanation}</Alert>}
    <Card ref={hero} tabIndex={-1} className="relative overflow-hidden" onKeyDown={event => { if (event.key === 'Escape' && detail && !busy) { event.preventDefault(); closeCard() } }}>
      <MapView />
      <MockMode filters={filters} layers={layers} refresh={refresh} onBusyChange={setBusy} />
      {detail && <Card size="sm" aria-live="polite" className="absolute bottom-36 left-3 z-10 w-80 max-w-[calc(100%-24px)] max-h-[max(0px,calc(100%-var(--overview-tools-height,150px)-168px))] overflow-auto"><CardContent className="flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{titleCase(detail.name)}</CardTitle><Signal level={detail.signalLevel} />{detail.simulation && <Signal level={detail.simulation.signalLevel} simulation />}<CloseButton aria-label="Close region summary" size="sm" onClick={closeCard} /></div><p>{detail.hierarchy.map(r => titleCase(r.name)).join(' / ')}</p><Metrics columns={2} values={[[ 'Estimated exposed', detail.estimatedExposedPopulation ], ['Reference population', detail.population], ['Active hazards', fresh.length || 'None'], ['Shelters', detail.recordedShelterCount]]} /><p>{fresh[0] ? hazardName(fresh[0].hazardType) + ' ' + hazardKind(fresh[0].evidenceType) + ' · ' + sourceName(fresh[0].source) : 'No active warning'}</p><Button variant="secondary" onClick={() => { const heading = document.getElementById('selected-name'); heading?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' }); heading?.focus({ preventScroll: true }) }}>View details</Button></CardContent></Card>}
      <Card size="sm" aria-label="Map legend" className="absolute bottom-8 left-3 z-10"><CardContent className="grid grid-cols-3 gap-x-3 gap-y-1">{(['CRITICAL', 'ELEVATED', 'WATCH', 'NORMAL', 'UNKNOWN', 'SIMULATION'] as const).map(value => {
        const count = rows.filter(r => value === 'SIMULATION' ? r.simulation : (r.simulation?.signalLevel || r.signalLevel) === value).length
        return <span key={value} className="flex items-center gap-1" style={{ opacity: count ? 1 : .5 }}><i className="h-2.5 w-2.5" style={{ backgroundColor: value === 'SIMULATION' ? '#EEF2FE' : severity[value].fill, border: '1px ' + (value === 'SIMULATION' ? 'dashed #2E54E6' : 'solid ' + severity[value].stroke) }} />{readable(value) + ' ' + String(count)}</span>
      })}</CardContent></Card>
    </Card>
    <Kpis rows={rows} cases={cases.data} loading={regions.isPending} error={regions.error} />
    <div className="grid gap-4 lg:grid-cols-[minmax(360px,5fr)_7fr]"><PriorityRegions rows={orderedRegions(rows)} selected={selected} onSelect={select} loading={regions.isPending} error={regions.error} /><div className="flex min-w-0 flex-col gap-4"><RegionPanel detail={detail} loading={selected !== null && region.isPending} error={region.error} /><Shelters detail={detail} loading={selected !== null && region.isPending} error={region.error} /><Needs detail={detail} loading={selected !== null && region.isPending} error={region.error} /><Sources detail={detail} loading={selected !== null && region.isPending} error={region.error} /></div></div>
  </div>
}
