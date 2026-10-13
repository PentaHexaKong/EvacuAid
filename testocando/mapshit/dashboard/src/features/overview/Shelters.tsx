import type { RegionDetail } from '@/lib/types'
import { Empty } from '@/components/app/primitives/empty'
import { DataState, Evidence, Metrics, number, Panel, sourceName, time } from './RegionPanel'

export function Shelters({ detail, loading, error }: { detail?: RegionDetail; loading: boolean; error: Error | null }) {
  return <Panel title="Shelter reference information" description="Reference capacity and accessibility, no live occupancy"><DataState loading={loading} error={error}>{detail ? <><Metrics values={[[ 'Recorded shelters', detail.recordedShelterCount ], ['Reference capacity', detail.totalShelterCapacity]]} />{detail.shelters.map(shelter => <Evidence key={shelter.id} title={shelter.name} description={'Capacity ' + number(shelter.capacity) + ' · ' + (shelter.wheelchairAccessible === true ? 'step-free access reported' : shelter.wheelchairAccessible === false ? 'not reported step-free' : 'step-free access unknown') + ' · ' + sourceName(shelter.source) + ' · recorded ' + time(shelter.verifiedAt)} tag={shelter.status} />)}{!detail.shelters.length && <Empty>No shelter records for this region.</Empty>}</> : <Empty>Select a region to inspect shelters.</Empty>}</DataState></Panel>
}
