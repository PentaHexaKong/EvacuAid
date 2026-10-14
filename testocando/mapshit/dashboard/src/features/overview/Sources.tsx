import type { RegionDetail } from '@/lib/types'
import { Empty } from '@/components/app/primitives/empty'
import { DataState, Evidence, groupHazards, hazardName, number, Panel, provenanceName, readable, sourceName } from './RegionPanel'
import { time } from '@/lib/format'

export function Sources({ detail, loading, error }: { detail?: RegionDetail; loading: boolean; error: Error | null }) {
  const routing = detail ? 'Responders available: ' + number(detail.availableResponderCount) + ' · assigned: ' + number(detail.assignedResponderCount) + '. Routes feasible: ' + number(detail.feasibleRouteCount) + ' · blocked: ' + number(detail.blockedRouteCount) + ' · no feasible route: ' + number(detail.noFeasibleRouteCount) + '. ' + detail.limitations.join(' ') : 'Responder inventory and regional routing status: Unknown.'
  return <Panel title="Data sources & freshness" description="Evidence, provenance and coverage"><DataState loading={loading} error={error}>{detail ? <>
    <Evidence title="Administrative boundary" description={sourceName(detail.boundarySource)} tag={detail.dataMode} />
    <Evidence title="Reference population" description={sourceName(detail.populationSource) + ' / ' + String(detail.populationReferenceYear || 'Unknown')} tag={detail.dataMode} />
    {groupHazards(detail.hazards).map((hazard, i) => <Evidence key={i} title={sourceName(hazard.source) + ' · ' + hazardName(hazard.hazardType)} description={[hazard.observedAt ? 'Observed ' + time(hazard.observedAt) : 'No observation time', hazard.expiresAt ? 'expires ' + time(hazard.expiresAt) : null, hazard.count > 1 ? String(hazard.count) + ' areas' : null].filter(Boolean).join(' · ')} tag={provenanceName(hazard.provenanceClass)} />)}
    <Evidence title="Reported profiles / assistance" description={readable(detail.metricProvenance.assistance)} tag={detail.dataMode} />
  </> : <Empty>No evidence loaded. Provider connections are not inferred.</Empty>}</DataState><p aria-label={routing.replaceAll('—', 'Unknown')}>{routing}</p></Panel>
}
