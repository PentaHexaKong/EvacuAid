import { Link } from 'react-router'
import { RiMap2Line, RiAlarmWarningLine, RiGroupLine, RiHandHeartLine, RiHome4Line } from '@remixicon/react'
import type { Region } from '@/lib/types'
import { useDataMode } from '@/app/data-mode'
import { DashboardPanel, DashboardStatCard } from '@/components/application/dashboard/dashboard-panel'
import { DataState } from './RegionPanel'

export function Kpis({ rows, cases, loading, error }: { rows: Region[]; cases?: { open: number; stale: number }; loading: boolean; error: Error | null }) {
  const { dataMode } = useDataMode()
  const sum = (key: 'estimatedExposedPopulation' | 'recordedShelterCount') => rows.length && rows.every(r => r[key] != null) ? rows.reduce((total, r) => total + (r[key] ?? 0), 0) : null
  const unknown = rows.filter(r => r.signalLevel === 'UNKNOWN').length
  const unknownNote = unknown ? ' · ' + String(unknown) + ' unknown' : ''
  const known = rows.some(r => r.signalLevel !== 'UNKNOWN')
  const stats = [
    { label: 'Regions with hazard signals', value: known ? rows.filter(r => !['UNKNOWN', 'NORMAL'].includes(r.signalLevel)).length : null, caption: 'Watch or higher' + unknownNote, title: 'Includes baseline WATCH · ' + String(unknown) + ' regions UNKNOWN', icon: RiMap2Line },
    { label: 'Critical regions', value: known ? rows.filter(r => r.signalLevel === 'CRITICAL').length : null, caption: 'Official critical signals' + unknownNote, title: 'Known official critical signals · ' + String(unknown) + ' regions UNKNOWN', icon: RiAlarmWarningLine },
    { label: 'Population exposed (est.)', value: sum('estimatedExposedPopulation'), caption: sum('estimatedExposedPopulation') == null ? 'No data' : 'Area-weighted estimate', title: 'Approximate · missing regions → UNKNOWN', icon: RiGroupLine },
    { label: 'Open assistance cases', value: dataMode === 'SIMULATION' ? null : cases?.open, caption: dataMode === 'SIMULATION' ? 'Hidden in simulation' : !cases ? "Couldn't load cases" : cases.stale ? String(cases.stale) + ' older than 24 h need review' : 'Updated just now', title: 'Open government assistance cases', icon: RiHandHeartLine },
    { label: 'Recorded shelters', value: sum('recordedShelterCount'), caption: 'Reference inventory', title: 'Reference inventory · no live occupancy tracking', icon: RiHome4Line },
  ]
  return <section aria-label="Regional key indicators"><DataState loading={loading} error={error}><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">{stats.map(stat => {
    const card = stat.value == null ? <DashboardPanel className="h-full" contentClassName="flex min-h-32 flex-col" header={<div className="flex w-full items-center gap-2.5"><span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-status-blue-background to-notification-information-background text-status-blue-text inset-shadow-xs"><stat.icon className="size-5" /></span><h2 className="min-w-0 flex-1 text-body-medium text-text-primary">{stat.label}</h2></div>}><div className="flex flex-1 items-center px-4 py-5"><p className="text-display-4-semibold tabular-nums text-text-primary" title="No data">—</p></div><footer className="flex items-center justify-between gap-3 border-t border-border-table bg-background-primary-default px-4 py-3"><span className="text-caption-1-regular text-text-secondary-strong">{stat.caption}</span></footer></DashboardPanel> : <DashboardStatCard stat={{ ...stat, value: stat.value, tone: 'blue' }} />
    return stat.label === 'Open assistance cases' ? <Link key={stat.label} to="/operations/assistance" title={stat.title}>{card}</Link> : <div key={stat.label} title={stat.title}>{card}</div>
  })}</div></DataState></section>
}
