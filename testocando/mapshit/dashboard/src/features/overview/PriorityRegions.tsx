import { useRef } from 'react'
import type { Region } from '@/lib/types'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/app/primitives/card'
import { Chip } from '@/components/base/badges/chip'
import { Empty } from '@/components/app/primitives/empty'
import { DataState, number, readable, Signal, titleCase } from './RegionPanel'

export function orderedRegions(rows: Region[]) {
  return ['CRITICAL', 'ELEVATED', 'WATCH', 'UNKNOWN', 'NORMAL'].flatMap(level => rows.filter(region => (region.simulation?.signalLevel || region.signalLevel) === level))
}
export function PriorityRegions({ rows, selected, onSelect, loading, error }: { rows: Region[]; selected: string | null; onSelect: (id: string) => void; loading: boolean; error: Error | null }) {
  const list = useRef<HTMLDivElement>(null)
  return <Card><CardHeader><div className="flex justify-between gap-3"><CardTitle><h2>Priority regions</h2></CardTitle><Chip>{String(rows.length) + (rows.length === 1 ? ' region' : ' regions')}</Chip></div></CardHeader><CardContent><DataState loading={loading} error={error}><div ref={list} role="listbox" aria-label="Priority regions" tabIndex={0} aria-activedescendant={selected ? 'region-' + selected : undefined} className="flex max-h-[640px] flex-col gap-2 overflow-auto" onKeyDown={event => {
    if (!rows.length || !['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return
    event.preventDefault()
    const current = rows.findIndex(region => region.id === selected)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : event.key === 'ArrowDown' ? Math.min(current + 1, rows.length - 1) : event.key === 'ArrowUp' ? current < 0 ? rows.length - 1 : Math.max(current - 1, 0) : Math.max(current, 0)
    if (rows[index]) onSelect(rows[index].id)
    document.getElementById('region-' + (rows[index]?.id ?? ''))?.scrollIntoView({ block: 'nearest' })
  }}>{rows.map((region, index) => {
    const level = region.simulation?.signalLevel || region.signalLevel
    const updated = region.updatedAt ? new Date(region.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '—'
    const description = (region.estimatedExposedPopulation == null ? 'Exposure unknown' : '≈' + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(region.estimatedExposedPopulation).toLowerCase() + ' exposed') + ' · Updated ' + updated + ((region.activeAssistanceCount ?? 0) > 0 ? ' · Assistance ' + number(region.activeAssistanceCount) : '')
    return <div key={region.id}>{(index === 0 || (rows[index - 1]?.simulation?.signalLevel || rows[index - 1]?.signalLevel) !== level) && <h3>{readable(level) + ' · ' + String(rows.filter(r => (r.simulation?.signalLevel || r.signalLevel) === level).length)}</h3>}<button type="button" id={'region-' + region.id} role="option" aria-selected={selected === region.id} tabIndex={-1} className={'w-full cursor-pointer px-3 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring ' + (selected === region.id ? 'bg-background-primary-active' : 'bg-background-default hover:bg-background-primary-hover')} title={region.snapshotStale ? 'Projection unavailable / stale' : description.replaceAll('—', 'Unknown')} onClick={() => { list.current?.focus({ preventScroll: true }); onSelect(region.id) }}><div className="flex w-full flex-col gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{titleCase(region.name)}</strong><span className="flex gap-1">{region.simulation && <Signal level={region.simulation.signalLevel} simulation />}<Signal level={region.signalLevel} /></span></div><p aria-label={description.replaceAll('—', 'Unknown')}>{description}</p></div></button></div>
  })}{!rows.length && <Empty>No imported regions match these filters. Import administrative GeoJSON to begin.</Empty>}</div></DataState></CardContent><CardFooter><details><summary>How regions are ordered</summary><p>Signal → official critical evidence → estimated exposed population → active assistance → uncertainty → region code. Unknown follows Watch and precedes Normal. Known higher counts rank first; missing counts remain unknown.</p></details></CardFooter></Card>
}
