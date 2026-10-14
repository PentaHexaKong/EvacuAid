import { useCheckIns } from '@/lib/queries';
import { OperationsPage, OperationsTime, label } from '@/features/operations/OperationsPage';
import { Card } from '@/components/app/primitives/card';
import { Empty } from '@/components/app/primitives/empty';
import { Skeleton } from '@/components/app/primitives/skeleton';
import { Chip } from '@/components/base/badges/chip';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/base/table/table';
export default function Page() {
    const query = useCheckIns();
    const rows = query.data?.regions ?? [];
    return <OperationsPage title="Check-ins" loading={query.isPending} error={query.error} receivedAt={query.dataUpdatedAt} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }}><p id="ops-checkins-scope" className="text-body-regular text-foreground-light">{query.data?.scope}</p><Card>{query.isPending ? <div className="grid gap-4 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full"/>)}</div> : query.data && !rows.length ? <Empty>No check-ins in the last 24 hours.</Empty> : query.data && <Table aria-label="Evacuation check-ins"><TableHeader><TableColumn isRowHeader>Evacuation check-ins</TableColumn><TableColumn>Status</TableColumn><TableColumn>People</TableColumn><TableColumn>Latest</TableColumn></TableHeader><TableBody>{rows.map((row, i) => <TableRow key={row.regionId + row.status + String(i)}><TableCell>{row.regionId}</TableCell><TableCell><Chip color={['ARRIVED', 'SAFE_REPORTED'].includes(row.status) ? 'blue' : row.status === 'NEEDS_ASSISTANCE' ? 'rose' : row.status === 'EVACUATING' ? 'yellow' : 'neutral'}>{label(row.status)}</Chip></TableCell><TableCell>{String(row.count) + ' people'}</TableCell><TableCell><OperationsTime value={row.lastObservedAt} now={query.dataUpdatedAt}/></TableCell></TableRow>)}</TableBody></Table>}</Card></OperationsPage>;
}
