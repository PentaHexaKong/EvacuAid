import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRoutes, useAssistanceCounts, usePublishRoute, useWithdrawRoute } from '@/lib/queries'
import type { OperationalRoute } from '@/lib/types'
import { OperationsPage, OperationsTime, label } from '@/features/operations/OperationsPage'
import { Card } from '@/components/app/primitives/card'
import { Empty } from '@/components/app/primitives/empty'
import { Skeleton } from '@/components/app/primitives/skeleton'
import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/base/table/table'
import { RouteForm } from './RouteForm'
import { updateRouteFields, isMockMode } from './formState'
import { setEvaluated } from './evaluated'

export default function Page() {
  const [offset, setOffset] = useState(0)
  const query = useRoutes({ offset })
  useAssistanceCounts()
  const publish = usePublishRoute()
  const withdraw = useWithdrawRoute()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [message, setMessage] = useState<{ text: string; at: number } | null>(null)
  const rows = query.data ?? []
  const pending = publish.isPending || withdraw.isPending
  const timestamp = () => client.getQueryState(['command', 'routes', { limit: 50, offset }])?.dataUpdatedAt ?? query.dataUpdatedAt
  async function save(route: OperationalRoute, publishing: boolean) {
    try {
      if (publishing && isMockMode()) throw new Error('Disable mock mode before publishing operational routes')
      await (publishing ? publish : withdraw).mutateAsync(route.id)
      setMessage({ text: publishing ? 'Route published.' : 'Route withdrawn.', at: timestamp() })
    } catch (error) { setMessage({ text: 'Could not save: ' + (error as Error).message, at: timestamp() }) }
  }
  return <OperationsPage title="Route setter" intro="Select a reference region on the map to load its recorded shelters. Routes are evaluated against known evidence, expire after five minutes, and require revalidation to publish. No overall safety certification." loading={query.isPending} error={query.error} receivedAt={query.dataUpdatedAt} message={message && query.dataUpdatedAt <= message.at ? message.text : ''} refreshing={query.isFetching || pending} onRefresh={() => { setMessage(null); void query.refetch() }}><div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(380px,2fr)_3fr]"><Card><RouteForm /></Card><div className="flex min-w-0 flex-col gap-4"><Card>{query.isPending ? <div className="grid gap-4 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div> : query.data && !rows.length ? <Empty>No routes yet. Select a region on the overview map, then calculate a draft below.</Empty> : query.data && <Table aria-label="Route Setter"><TableHeader><TableColumn isRowHeader>Route</TableColumn><TableColumn>Status</TableColumn><TableColumn>Shelter</TableColumn><TableColumn>Expires</TableColumn><TableColumn>More actions</TableColumn></TableHeader><TableBody>{rows.map(route => <TableRow key={route.id}><TableCell><div className="flex flex-col gap-2"><strong>{route.name}</strong><span>{label(route.result.routeStatus)}</span><span>{route.result.selectionReasonCodes.map(label).join(', ')}</span><span>Safety not verified</span></div></TableCell><TableCell><Chip color={route.stale ? 'neutral' : route.usable || route.status === 'PUBLISHED' ? 'blue' : 'neutral'}>{label(route.status) + (route.stale ? ' · Stale' : '')}</Chip></TableCell><TableCell>{route.result.shelterName || 'Shelter'}</TableCell><TableCell><OperationsTime value={route.expiresAt} now={query.dataUpdatedAt} /></TableCell><TableCell><div className="flex flex-wrap gap-2">{route.result.route?.geometry && <Button variant="secondary" onClick={() => { if (route.result.route) setEvaluated({ geometry: route.result.route.geometry, usable: route.usable }); void navigate('/overview') }}>Show evaluated geometry</Button>}<Button variant="secondary" disabled={pending} onClick={() => { updateRouteFields({ id: route.id, name: route.name, regionId: route.regionId, shelterId: route.shelterId, latitude: String(route.originLatitude), longitude: String(route.originLongitude), mobilityRequired: route.mobilityRequired }); document.getElementById('route-form')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' }) }}>Edit / recalculate</Button><Button variant="secondary" disabled={pending} onClick={() => { void save(route, true) }}>Revalidate and publish</Button><Button variant="secondary" disabled={pending} onClick={() => { void save(route, false) }}>Withdraw</Button></div></TableCell></TableRow>)}</TableBody></Table>}</Card>{(offset !== 0 || rows.length >= 50) && <div className="flex gap-2"><Button variant="secondary" disabled={offset === 0} onClick={() => { setMessage(null); setOffset(Math.max(0, offset - 50)) }}>Previous routes</Button><Button variant="secondary" disabled={rows.length < 50} onClick={() => { setMessage(null); setOffset(offset + 50) }}>Next routes</Button></div>}</div></div></OperationsPage>
}
