import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAssistance, useRoutes, useUpdateAssistance } from '@/lib/queries'
import type { AssistanceCase, CaseUpdate } from '@/lib/types'
import { OperationsPage, OperationsTime, label } from '@/features/operations/OperationsPage'
import { OpsDialog, type OpsValue } from '@/features/operations/OpsDialog'
import { Card } from '@/components/app/primitives/card'
import { Empty } from '@/components/app/primitives/empty'
import { Skeleton } from '@/components/app/primitives/skeleton'
import { Chip } from '@/components/base/badges/chip'
import { Button } from '@/components/base/buttons/button'
import { Select, SelectItem } from '@/components/base/select/select'
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/base/table/table'

const steps = { ACKNOWLEDGED: 'Acknowledge', DISPATCHED: 'Dispatch', COMPLETED: 'Mark completed', CANCELLED: 'Cancel' }
export default function Page() {
  const [offset, setOffset] = useState(0)
  const query = useAssistance({ offset })
  const routes = useRoutes()
  const mutation = useUpdateAssistance()
  const client = useQueryClient()
  const [dialog, setDialog] = useState<{ item: AssistanceCase; status: CaseUpdate['status']; routeId?: string; required?: boolean } | null>(null)
  const [assigned, setAssigned] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ text: string; at: number } | null>(null)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const rows = query.data ?? []
  const available = (routes.data ?? []).filter(route => route.usable)
  const timestamp = () => client.getQueryState(['command', 'assistance', { limit: 50, offset }])?.dataUpdatedAt ?? query.dataUpdatedAt
  function close() { setDialog(null); requestAnimationFrame(() => { trigger?.focus({ preventScroll: true }) }) }
  function open(item: AssistanceCase, status: CaseUpdate['status'], button: HTMLButtonElement, required = false) {
    setTrigger(button)
    if (required && !assigned[item.requestId]) { setMessage({ text: 'Could not save: Choose a current published route', at: timestamp() }); return }
    setDialog({ item, status, routeId: required ? assigned[item.requestId] : item.government?.assignedRouteId ?? '', required })
  }
  async function save(value: OpsValue) {
    if (!dialog) return
    const { item, status } = dialog
    close()
    try {
      await mutation.mutateAsync({ requestId: item.requestId, status, note: value.note, expectedUpdatedAt: item.caseUpdatedAt, assignedRouteId: status === 'DISPATCHED' ? value.assignedRouteId || item.government?.assignedRouteId || null : null })
      setMessage({ text: 'Case ' + item.requestId.slice(0, 8) + ' ' + { ACKNOWLEDGED: 'acknowledged', DISPATCHED: 'dispatched', COMPLETED: 'completed', CANCELLED: 'cancelled' }[status] + '.', at: timestamp() })
    } catch (error) { setMessage({ text: 'Could not save: ' + (error as Error).message, at: timestamp() }) }
  }
  function table(items: AssistanceCase[]) {
    return <Table aria-label="Assistance case management"><TableHeader><TableColumn isRowHeader>Assistance case management</TableColumn><TableColumn>Status</TableColumn><TableColumn>updated</TableColumn><TableColumn>Government action</TableColumn><TableColumn>Note</TableColumn><TableColumn>More actions</TableColumn></TableHeader><TableBody>{items.map(item => {
      const id = item.requestId.slice(0, 8)
      const next = ({ ACKNOWLEDGED: 'DISPATCHED', DISPATCHED: 'COMPLETED', COMPLETED: null, CANCELLED: null } as const)[item.government?.status ?? 'COMPLETED'] ?? (item.government?.status ? null : 'ACKNOWLEDGED')
      return <TableRow key={item.requestId}><TableCell><div className="flex flex-col gap-2"><strong>{'Case ' + id}</strong><span>{item.supportNeeds.map(label).join(', ') || 'No needs reported'}</span></div></TableCell><TableCell><Chip color={item.stale ? 'neutral' : ['RESOLVED', 'COMPLETED', 'ARRIVED', 'SAFE_REPORTED'].includes(item.status) ? 'blue' : ['NEEDS_ASSISTANCE', 'UNANSWERED', 'INTERRUPTED'].includes(item.status) ? 'rose' : ['DISPATCHED', 'EVACUATING', 'ACKNOWLEDGED'].includes(item.status) ? 'yellow' : 'neutral'}>{label(item.status) + (item.stale ? ' · Stale' : '')}</Chip></TableCell><TableCell><OperationsTime value={item.observedAt} now={query.dataUpdatedAt} /></TableCell><TableCell>{item.government?.status ? label(item.government.status) : 'Unassigned'}</TableCell><TableCell>{item.government?.note}</TableCell><TableCell><div className="flex flex-wrap gap-2">{next && <Button disabled={mutation.isPending} onClick={event => { open(item, next, event.currentTarget) }}>{steps[next]}</Button>}<details><summary>More actions</summary><div className="flex flex-col gap-2">{(Object.keys(steps) as CaseUpdate['status'][]).filter(status => status !== next).map(status => <Button key={status} variant="secondary" disabled={mutation.isPending} onClick={event => { open(item, status, event.currentTarget) }}>{steps[status]}</Button>)}<Select aria-label={'Assign published route to case ' + id} placeholder="Choose published route" value={assigned[item.requestId] || null} onChange={key => { setAssigned(current => ({ ...current, [item.requestId]: String(key ?? '') })) }}><SelectItem id="">Choose published route</SelectItem>{available.map(route => <SelectItem key={route.id} id={route.id}>{route.name}</SelectItem>)}</Select><Button variant="secondary" disabled={mutation.isPending} onClick={event => { open(item, 'DISPATCHED', event.currentTarget, true) }}>Assign route and dispatch</Button></div></details></div></TableCell></TableRow>
    })}</TableBody></Table>
  }
  const fresh = rows.filter(item => !item.stale)
  const older = rows.filter(item => item.stale)
  return <OperationsPage title="Assistance" intro="Anonymous case identifiers and reported needs. Government completion records dispatch work; it never asserts citizen safety or completes a Buddy session." loading={query.isPending || routes.isPending} error={query.error || routes.error} receivedAt={query.dataUpdatedAt} message={message && query.dataUpdatedAt <= message.at ? message.text : ''} refreshing={query.isFetching || routes.isFetching || mutation.isPending || dialog !== null} onRefresh={() => { setMessage(null); void query.refetch(); void routes.refetch() }}><Card>{query.isPending ? <div className="grid gap-4 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div> : query.data && <>{fresh.length ? table(fresh) : <Empty>{older.length ? 'No assistance requests in the last 24 hours.' : 'No open assistance requests.'}</Empty>}{older.length > 0 && <details><summary>{'Older than 24 hours (' + String(older.length) + ')'}</summary>{table(older)}</details>}</>}</Card>{(offset !== 0 || rows.length >= 50) && <div className="flex gap-2"><Button variant="secondary" disabled={offset === 0} onClick={() => { setMessage(null); setOffset(Math.max(0, offset - 50)) }}>Previous cases</Button><Button variant="secondary" disabled={rows.length < 50} onClick={() => { setMessage(null); setOffset(offset + 50) }}>Next cases</Button></div>}{dialog && <OpsDialog title={steps[dialog.status] + ' case ' + dialog.item.requestId.slice(0, 8)} context={(dialog.item.supportNeeds.map(label).join(', ') || 'No needs reported') + ' · Government action: ' + (dialog.item.government?.status ? label(dialog.item.government.status) : 'Unassigned')} minNote={3} barrier={false} routes={dialog.status === 'DISPATCHED' ? available : null} initialRouteId={dialog.routeId} routeRequired={dialog.required} submitLabel={steps[dialog.status]} onClose={close} onSubmit={value => { void save(value) }} />}</OperationsPage>
}
