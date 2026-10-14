import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataMode } from '@/app/data-mode'
import { allRegions } from '@/lib/api'
import type { Region } from '@/lib/types'
import { PageHeader, PageHeaderSummary, PageHeaderTitle } from '@/components/app/PageHeader'
import { Card, CardContent } from '@/components/app/primitives/card'

const initial = 'Operational data. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. Hazard and shelter overlays load when a region is selected.'

// Same sentence dashboard.js wrote into #about-data-text after an operational load.
export function aboutText(rows: Pick<Region, 'snapshotStale'>[] | undefined) {
  if (!rows) return initial
  const stale = rows.filter(r => r.snapshotStale).length
  return 'Operational data. ' + String(rows.length) + ' regions in the current filter scope. ' + String(stale) + ' unavailable/stale projections. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. ' + (!rows.length ? 'Import administrative GeoJSON using the command importer.' : 'Hazard and shelter overlays load when a region is selected.')
}

export default function Page() {
  const { dataMode } = useDataMode()
  useEffect(() => { document.title = 'About this data · EvacuAid Command Center' }, [])
  // Legacy only rewrote the text on operational loads, so SIMULATION keeps the last operational copy.
  const params = { administrativeLevel: 'VILLAGE' }
  const regions = useQuery({ queryKey: ['command', 'regions', 'REFERENCE', params], enabled: dataMode === 'REFERENCE', queryFn: () => allRegions({ ...params, dataMode: 'REFERENCE' }) })
  return <div className="flex min-w-0 flex-col gap-4">
    <PageHeader><PageHeaderSummary><PageHeaderTitle>About this data</PageHeaderTitle></PageHeaderSummary></PageHeader>
    <Card><CardContent><p id="about-data-text" className="max-w-prose">{aboutText(regions.data)}</p></CardContent></Card>
    <footer className="text-caption-1-regular text-text-secondary-strong">EvacuAid Command Center · Regional aggregates · Anonymous assistance cases · Public field reports</footer>
  </div>
}
