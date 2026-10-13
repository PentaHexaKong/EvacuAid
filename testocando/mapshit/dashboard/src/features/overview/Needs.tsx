import type { RegionDetail } from '@/lib/types'
import { DataState, Metrics, Panel } from './RegionPanel'

export function Needs({ detail, loading, error }: { detail?: RegionDetail; loading: boolean; error: Error | null }) {
  return <Panel title="Reported assistance needs" description="Reported categories may overlap."><DataState loading={loading} error={error}>{detail && <Metrics values={[[ 'Mobility', detail.assistance.mobilityNeedCount ], ['Visual', detail.assistance.visualNeedCount], ['Hearing', detail.assistance.hearingNeedCount], ['Elderly', detail.assistance.elderlyNeedCount], ['Other', detail.assistance.otherNeedCount]]} />}</DataState><p>These are reported needs among recently located EvacuAid profiles. Categories must not be summed as unique people or interpreted as demographic prevalence.</p></Panel>
}
