import type { ReactNode } from 'react'
import type { HazardSummary, RegionDetail, SignalLevel } from '@/lib/types'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/app/primitives/card'
import { Alert } from '@/components/app/primitives/alert'
import { Empty } from '@/components/app/primitives/empty'
import { Skeleton } from '@/components/app/primitives/skeleton'
import { Chip } from '@/components/base/badges/chip'

export const severity = {
  CRITICAL: { soft: '#FBE4E1', ink: '#B42318', fill: '#E8A69D', stroke: '#B42318', opacity: .6 },
  ELEVATED: { soft: '#FCEFD9', ink: '#7A4206', fill: '#F4C59A', stroke: '#C2470F', opacity: .45 },
  WATCH: { soft: '#FBF3D6', ink: '#6B5000', fill: '#F6E2A9', stroke: '#B38B00', opacity: .22 },
  NORMAL: { soft: '#E3F0FA', ink: '#1A5A96', fill: '#A9D0EE', stroke: '#1F6FC8', opacity: .08 },
  UNKNOWN: { soft: '#EDF0F8', ink: '#47587F', fill: '#DDE2EE', stroke: '#8C97B3', opacity: .12 },
}
export const readable = (value: string | null | undefined): string => value == null || value === 'UNKNOWN' ? 'Unknown' : value.toLowerCase().replaceAll('_', ' ').replace(/^./u, letter => letter.toUpperCase())
export const titleCase = (value: string) => value.replace(/\p{L}+/gu, word => word.length > 3 && word === word.toUpperCase() ? (word[0] ?? '') + word.slice(1).toLowerCase() : word)
export const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value)
import { time } from '@/lib/format'
export const shortTime = (value: string | null) => value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Unknown'
export const hazardName = (value: string) => ({ FLOOD: 'Flood', EARTHQUAKE: 'Earthquake', TSUNAMI: 'Tsunami', WILDFIRE: 'Wildfire', LANDSLIDE: 'Landslide', EXTREME_WEATHER: 'Extreme weather' }[value] || readable(value))
export const sourceName = (value: string | null) => ({ INARISK: 'InaRISK (BNPB)', BMKG_CAP: 'BMKG', BMKG_EARTHQUAKE: 'BMKG', PETABENCANA: 'PetaBencana', FIRMS: 'NASA FIRMS', DEMO_SIMULATION: 'EvacuAid simulation' }[value ?? ''] || (value == null || value === 'UNKNOWN' ? 'Unknown' : value))
export const provenanceName = (value: string) => ({ OFFICIAL_BASELINE: 'reference layer, not an active warning', OFFICIAL_ACTIVE: 'official active', COMMUNITY_OBSERVATION: 'community report', SATELLITE_OBSERVATION: 'satellite', SIMULATION: 'simulation' }[value] || readable(value))
export const hazardKind = (value: string) => ({ BASELINE_HAZARD: 'susceptibility', ACTIVE_WARNING: 'warning', CRITICAL_HAZARD: 'critical hazard', OBSERVATION: 'observation', CONFIRMED_CLOSURE: 'closure' }[value] || readable(value).toLowerCase())
export function groupHazards(hazards: HazardSummary[]) {
  const groups = new Map<string, HazardSummary & { count: number }>()
  for (const hazard of hazards) {
    const key = JSON.stringify([hazard.hazardType, hazard.source, hazard.evidenceType, hazard.provenanceClass, hazard.freshness, hazard.expiresAt, hazard.active])
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { ...hazard, count: 1 })
  }
  return [...groups.values()]
}
export function Signal({ level, simulation = false }: { level: SignalLevel; simulation?: boolean }) {
  return <Chip variant="caption" style={{ backgroundColor: severity[level].soft, color: severity[level].ink }}>{simulation ? 'Simulation · ' : ''}{readable(level)}</Chip>
}
export function Metrics({ values, columns = 3 }: { values: [string, number | null | undefined | string][]; columns?: 2 | 3 }) {
  return <dl className={columns === 2 ? "grid grid-cols-2 gap-4" : "grid grid-cols-2 gap-4 sm:grid-cols-3"}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="text-body-semibold tabular-nums" aria-label={value == null ? 'Unknown' : undefined}>{typeof value === 'string' ? value : number(value)}</dd></div>)}</dl>
}
export function Evidence({ title, description, tag }: { title: string; description: string; tag: string }) {
  return <div className="flex items-start justify-between gap-3" aria-label={description.includes('—') ? (title + '. ' + description).replaceAll('—', 'Unknown') : undefined}><div><strong>{title}</strong><p>{description}</p></div><Chip variant="caption">{readable(tag)}</Chip></div>
}
export function Panel({ title, description, children, aside, id }: { title: string; description?: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle><h2 id={id} tabIndex={id ? -1 : undefined}>{title}</h2></CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>{aside}</div></CardHeader><CardContent className="flex flex-col gap-4">{children}</CardContent></Card>
}
export function DataState({ loading, error, children }: { loading?: boolean; error?: Error | null; children: ReactNode }) {
  return loading ? <Skeleton className="h-32 w-full" /> : error ? <Alert variant="destructive">{error.message}</Alert> : children
}
export function RegionPanel({ detail, loading, error }: { detail?: RegionDetail; loading: boolean; error: Error | null }) {
  const populationTitle = detail ? (detail.dataMode === 'SIMULATION' ? 'SIMULATION / DEMO DATA. ' : '') + 'Population: ' + (detail.populationSource || 'UNKNOWN source') + ' / ' + String(detail.populationReferenceYear || 'UNKNOWN year') + '. Exposure method: ' + detail.exposureEstimationMethod + '. Area-weighted estimates assume uniformly distributed population. No exact affected-person count. Projection: ' + time(detail.updatedAt) + (detail.snapshotStale ? ' · STALE' : '') + '. ' + detail.assistance.scope : undefined
  return <Panel title={detail ? titleCase(detail.name) : 'Choose a region'} id="selected-name" description={detail ? detail.hierarchy.map(r => titleCase(r.name)).join(' / ') || readable(detail.administrativeLevel) : 'Select a polygon or a priority region.'} aside={<Signal level={detail?.signalLevel ?? 'UNKNOWN'} />}><DataState loading={loading} error={error}>{detail ? <>
    {detail.simulation && <Alert>{'Simulation: ' + readable(detail.simulation.signalLevel) + ' ' + detail.simulation.hazardTypes.map(type => hazardName(type).toLowerCase()).join(', ') + ', ' + detail.simulation.names.join(', ') + '. Official signal unchanged.'}</Alert>}
    <Metrics values={[[ 'Reference population', detail.population ], ['Estimated exposed', detail.estimatedExposedPopulation], ['Active assistance', detail.assistance.activeAssistanceCount], ['Evacuating requests', detail.assistance.evacuatingCount], ['Safe request statuses', detail.assistance.safeCheckInCount], ['Unknown safety', detail.assistance.unknownSafetyCount]]} />
    <p title={populationTitle}>{(detail.dataMode === 'SIMULATION' ? 'Simulation data. ' : '') + (!detail.populationSource && !detail.populationReferenceYear ? 'Population source and year unknown' : 'Population: ' + sourceName(detail.populationSource) + ' / ' + String(detail.populationReferenceYear || 'Unknown')) + (detail.exposureEstimationMethod !== 'UNKNOWN' ? '; exposure method: ' + readable(detail.exposureEstimationMethod).toLowerCase() : '') + '. Projection updated ' + shortTime(detail.updatedAt) + '.' + (detail.snapshotStale ? ' Stale.' : '')}</p>
    {groupHazards(detail.hazards).map((hazard, i) => <Evidence key={i} title={hazardName(hazard.hazardType) + ' ' + hazardKind(hazard.evidenceType) + (hazard.count > 1 ? ' · ' + String(hazard.count) + ' areas' : '')} description={sourceName(hazard.source) + ' · ' + provenanceName(hazard.provenanceClass)} tag={hazard.freshness} />)}
    {!detail.hazards.length && <Empty>Hazard evidence: Unknown. No intersecting normalized evidence in this projection.</Empty>}
  </> : null}</DataState></Panel>
}
