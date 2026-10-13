import { useState } from 'react'
import type { HazardType, MockDisasterCreate, SafeHouseCreate, ShelterStatus } from '@/lib/types'
import { FormDialog, FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader, FormDialogTitle } from '@/components/app/FormDialog'
import { Input, InputBase, TextField } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { Alert } from '@/components/app/primitives/alert'
import { Label } from '@/components/base/input/label'
import { hazardName } from './RegionPanel'

function NumberInput({ label, value, onChange, min, max, step, isRequired, placeholder }: { label: string; value: string; onChange: (value: string) => void; min: number; max: number; step?: string; isRequired?: boolean; placeholder?: string }) {
  return <TextField isRequired={isRequired} value={value} onChange={onChange}><Label>{label}</Label><InputBase type="number" min={min} max={max} step={step} placeholder={placeholder} /></TextField>
}

export const hazardTypes: HazardType[] = ['FLOOD', 'EARTHQUAKE', 'TSUNAMI', 'WILDFIRE', 'LANDSLIDE', 'EXTREME_WEATHER']
export type Draft = { id: string; kind: 'hazard' | 'safeHouse'; mock: boolean; latitude?: number; longitude?: number }
export function SafeHouseDialog({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (payload: SafeHouseCreate | MockDisasterCreate) => Promise<void> }) {
  const [name, setName] = useState('')
  const [latitude, setLatitude] = useState(draft.latitude?.toFixed(6) ?? '')
  const [longitude, setLongitude] = useState(draft.longitude?.toFixed(6) ?? '')
  const [hazard, setHazard] = useState<HazardType>('FLOOD')
  const [severity, setSeverity] = useState<MockDisasterCreate['severity']>('ELEVATED')
  const [radius, setRadius] = useState('1000')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<ShelterStatus>('UNKNOWN')
  const [capacity, setCapacity] = useState('')
  const [access, setAccess] = useState('')
  const [verified, setVerified] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const disaster = draft.kind === 'hazard'
  return <FormDialog open onOpenChange={open => { if (!open && !saving) onClose() }}><FormDialogContent><FormDialogHeader closeDisabled={saving}><div className="flex min-w-0 flex-col gap-2"><Chip color={disaster || draft.mock ? 'yellow' : 'neutral'}>{disaster ? 'Simulation · Watch appears in the app; Elevated and Critical can send test push notifications' : draft.mock ? 'Mock · this browser only' : 'Operational · saves to backend'}</Chip><FormDialogTitle>{disaster ? 'Add mock disaster' : draft.mock ? 'Add mock safe house' : 'Add safe house'}</FormDialogTitle></div></FormDialogHeader><form className="flex min-h-0 flex-col gap-4" onSubmit={event => {
    event.preventDefault()
    void (async () => {
    if (saving) return
    setSaving(true); setError('')
    try {
      if (!name.trim()) throw new Error('Enter a name.')
      const base = { id: draft.id, name: name.trim(), latitude: Number(latitude), longitude: Number(longitude) }
      await onSave(disaster ? { ...base, hazardType: hazard, radiusM: Number(radius), severity } : { ...base, address: address.trim() || null, status, capacity: capacity === '' ? null : Number(capacity), wheelchairAccessible: access === '' ? null : access === 'true', verifiedNow: verified })
      onClose()
    } catch (error) { setError((error as Error).message) }
    finally { setSaving(false) }
    })()
  }}><FormDialogBody animateResize={false}>
    {draft.latitude != null && draft.longitude != null ? <p>{'Location: ' + latitude + ', ' + longitude}</p> : <div className="grid grid-cols-2 gap-4"><NumberInput label="Assembly-point latitude" step="any" min={-90} max={90} isRequired value={latitude} onChange={setLatitude} /><NumberInput label="Assembly-point longitude" step="any" min={-180} max={180} isRequired value={longitude} onChange={setLongitude} /></div>}
    <Input label="Name" autoFocus isRequired maxLength={200} value={name} onChange={setName} />
    {disaster ? <div className="grid gap-4 sm:grid-cols-3"><div><span>Disaster type</span><Select aria-label="Disaster type" value={hazard} onChange={key => { setHazard(key as HazardType); }}>{hazardTypes.map(type => <SelectItem key={type} id={type}>{hazardName(type)}</SelectItem>)}</Select></div><NumberInput label="Radius (metres)" min={50} max={50000} isRequired value={radius} onChange={setRadius} /><div><span>Mock severity</span><Select aria-label="Mock severity" value={severity} onChange={key => { setSeverity(key as MockDisasterCreate['severity']); }}><SelectItem id="WATCH">Watch</SelectItem><SelectItem id="ELEVATED">ELEVATED</SelectItem><SelectItem id="CRITICAL">Critical</SelectItem></Select></div></div> : <><Input label="Address" maxLength={500} value={address} onChange={setAddress} /><div className="grid gap-4 sm:grid-cols-3"><div><span>Status</span><Select aria-label="Status" value={status} onChange={key => { setStatus(key as ShelterStatus); }}><SelectItem id="UNKNOWN">Unknown</SelectItem><SelectItem id="OPEN">Open</SelectItem><SelectItem id="CLOSED">Closed</SelectItem></Select></div><NumberInput label="Capacity" min={0} max={1000000} placeholder="Unknown" value={capacity} onChange={setCapacity} /><div><span>Wheelchair access</span><Select aria-label="Wheelchair access" value={access || 'unknown'} onChange={key => { setAccess(key === 'unknown' ? '' : String(key)); }}><SelectItem id="unknown">Unknown</SelectItem><SelectItem id="true">Yes</SelectItem><SelectItem id="false">No</SelectItem></Select></div></div><Checkbox isSelected={verified} onChange={setVerified}>Reference details verified now</Checkbox><p>Saving a location does not certify hazard safety or evacuation access.</p></>}
    {error && <Alert variant="destructive">{error}</Alert>}
  </FormDialogBody><FormDialogFooter><Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></FormDialogFooter></form></FormDialogContent></FormDialog>
}
