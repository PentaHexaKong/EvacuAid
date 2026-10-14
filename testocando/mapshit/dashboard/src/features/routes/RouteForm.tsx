import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useDataMode } from '@/app/data-mode'
import { useCreateRoute, useRegion, useRegions } from '@/lib/queries'
import { useMap, useMapHost } from '@/map/MapProvider'
import { Button } from '@/components/base/buttons/button'
import { TextField, InputBase } from '@/components/base/input/input'
import { Label } from '@/components/base/input/label'
import { Select, SelectItem } from '@/components/base/select/select'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Alert } from '@/components/app/primitives/alert'
import { Skeleton } from '@/components/app/primitives/skeleton'
import { pickAssembly } from './pick'
import { isMockMode } from './formState'
import { label } from '@/features/operations/OperationsPage'
import { useRouteFields, updateRouteFields, resetRouteFields, selectRouteRegion } from './formState'

export function RouteForm() {
  const fields = useRouteFields()
  const { dataMode } = useDataMode()
  const regions = useRegions()
  // Legacy selected the first loaded region at boot, so a cold load into Route setter already has one.
  const first = dataMode === 'REFERENCE' ? regions.data?.[0]?.id : undefined
  useEffect(() => { if (!fields.regionId && first) selectRouteRegion(first) }, [fields.regionId, first])
  const region = useRegion(fields.regionId || null)
  const create = useCreateRoute()
  const map = useMap()
  const host = useMapHost()
  const navigate = useNavigate()
  async function save() {
    try {
      if (isMockMode()) throw new Error('Disable mock mode before calculating operational routes')
      const id = fields.id || crypto.randomUUID()
      updateRouteFields({ id })
      const route = await create.mutateAsync({ id, name: fields.name.trim(), regionId: fields.regionId, shelterId: fields.shelterId, originLatitude: Number(fields.latitude), originLongitude: Number(fields.longitude), mobilityRequired: fields.mobilityRequired })
      updateRouteFields({ feedback: 'Draft saved · ' + label(route.result.routeStatus) + ' · ' + route.result.selectionReasonCodes.map(label).join(', ') + '. Publish re-evaluates current evidence.' })
    } catch (error) { updateRouteFields({ feedback: (error as Error).message }) }
  }
  return <form id="route-form" className="flex flex-col gap-4 p-4" onSubmit={event => { event.preventDefault(); void save() }}><p>Region: <strong>{region.data?.name ?? 'Select a region'}</strong></p>{region.error && <Alert variant="destructive">{region.error.message}</Alert>}{fields.regionId && region.isPending && <Skeleton className="h-8 w-full" />}<TextField isRequired value={fields.name} onChange={name => { updateRouteFields({ name }) }}><Label>Route name</Label><InputBase minLength={3} maxLength={120} /></TextField><div className="grid gap-4 sm:grid-cols-2"><TextField isRequired value={fields.latitude} onChange={latitude => { updateRouteFields({ latitude }) }}><Label>Assembly-point latitude</Label><InputBase type="number" step="any" min={-90} max={90} /></TextField><TextField isRequired value={fields.longitude} onChange={longitude => { updateRouteFields({ longitude }) }}><Label>Assembly-point longitude</Label><InputBase type="number" step="any" min={-180} max={180} /></TextField></div><div><span id="route-shelter-label">Recorded shelter</span><Select aria-labelledby="route-shelter-label" isRequired placeholder={region.data ? 'Choose shelter' : 'Select a region first'} value={fields.shelterId || null} onChange={key => { updateRouteFields({ shelterId: String(key ?? '') }) }}><SelectItem id="">{region.data ? 'Choose shelter' : 'Select a region first'}</SelectItem>{(region.data?.shelters ?? []).map(shelter => <SelectItem key={shelter.id} id={shelter.id}>{shelter.name + ' · reference capacity ' + String(shelter.capacity ?? 'unknown') + ' · step-free ' + String(shelter.wheelchairAccessible ?? 'unknown')}</SelectItem>)}</Select></div><Checkbox isSelected={fields.mobilityRequired} onChange={mobilityRequired => { updateRouteFields({ mobilityRequired }) }}>Require step-free routing (unknown accessibility remains unknown)</Checkbox><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!map} aria-describedby={!map && host?.note ? 'route-map-note' : undefined} onClick={() => { if (map) void pickAssembly(map, path => { void navigate(path) }) }}>Pick assembly point on map</Button><Button variant="ghost" onClick={resetRouteFields}>New route</Button><Button type="submit" disabled={create.isPending}>Calculate and save draft</Button></div>{!map && host?.note && <p id="route-map-note">{host.note}</p>}<p id="route-feedback" role="status">{fields.feedback}</p></form>
}
