import { useRef, useState } from 'react';
import { Popover, PopoverContent } from '@/components/base/popover/popover'
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useReports, useConfirmReport, useRejectReport, useResolveReport, useRoutes, useAssistanceCounts } from '@/lib/queries';
import type { FieldReport, ReportReviewStatus } from '@/lib/types';
import { useMap } from '@/map/MapProvider';
import { drawReport } from './drawReport';
import { MenuAction, OperationsPage, OperationsTime, label } from '@/features/operations/OperationsPage';
import { OpsDialog, type OpsValue } from '@/features/operations/OpsDialog';
import { Card } from '@/components/app/primitives/card';
import { Empty } from '@/components/app/primitives/empty';
import { Skeleton } from '@/components/app/primitives/skeleton';
import { Chip } from '@/components/base/badges/chip';
import { Button, MenuButton } from '@/components/base/buttons/button';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/base/table/table';
export default function Page() {
    const [offset, setOffset] = useState(0);
    const query = useReports({ offset });
    const client = useQueryClient();
    useRoutes();
    useAssistanceCounts();
    const confirm = useConfirmReport();
    const reject = useRejectReport();
    const resolve = useResolveReport();
    const map = useMap();
    const navigate = useNavigate();
    const [dialog, setDialog] = useState<{
        report: FieldReport;
        status: ReportReviewStatus;
    } | null>(null);
    const [message, setMessage] = useState<{ text: string; at: number } | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const rows = query.data ?? [];
    const pending = confirm.isPending || reject.isPending || resolve.isPending;
    const submitLabels = { CONFIRMED: 'Confirm report', REJECTED: 'Reject report', RESOLVED: 'Mark resolved' };
    function close() { setDialog(null); requestAnimationFrame(() => { trigger.current?.focus({ preventScroll: true }); }); }
    function review(report: FieldReport, status: ReportReviewStatus, button: HTMLButtonElement) { trigger.current = button; setDialog({ report, status }); }
    async function save(value: OpsValue) {
        if (!dialog)
            return;
        const { report, status } = dialog;
        close();
        try {
            const mutation = status === 'CONFIRMED' ? confirm : status === 'REJECTED' ? reject : resolve;
            await mutation.mutateAsync({ id: report.id, note: value.note, expectedUpdatedAt: report.updatedAt, barrier: value.barrier, radiusM: value.radiusM, validUntil: value.validUntil });
            setMessage({ text: 'Report ' + { CONFIRMED: 'confirmed', REJECTED: 'rejected', RESOLVED: 'resolved' }[status] + '.', at: client.getQueryState(['command', 'reports', { limit: 50, offset }])?.dataUpdatedAt ?? query.dataUpdatedAt });
        }
        catch (error) {
            setMessage({ text: 'Could not save: ' + (error as Error).message, at: client.getQueryState(['command', 'reports', { limit: 50, offset }])?.dataUpdatedAt ?? query.dataUpdatedAt });
        }
    }
    return <OperationsPage title="Field reports" intro="Unverified reports support awareness. Only an explicitly confirmed barrier becomes a hard routing exclusion. Locations describe public incidents; exclude citizen personal details." loading={query.isPending} error={query.error} receivedAt={query.dataUpdatedAt} message={message && query.dataUpdatedAt <= message.at ? message.text : ''} refreshing={query.isFetching || pending || dialog !== null} onRefresh={() => { setMessage(null); void query.refetch(); }}><Card>{query.isPending ? <div className="grid gap-4 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full"/>)}</div> : query.data && !rows.length ? <Empty>No field reports to review. New public reports appear here within 15 seconds.</Empty> : query.data && <Table aria-label="Field report review"><TableHeader><TableColumn isRowHeader>Field report review</TableColumn><TableColumn>Status</TableColumn><TableColumn>Observed</TableColumn><TableColumn>Received</TableColumn><TableColumn>Note</TableColumn><TableColumn>More actions</TableColumn></TableHeader><TableBody>{rows.map(report => {
                const stale = (report as FieldReport & {
                    stale?: boolean;
                }).stale;
                return <TableRow key={report.id}><TableCell><div className="flex flex-col gap-2"><strong>{label(report.kind)}</strong><span title={report.description}>{report.description}</span></div></TableCell><TableCell><Chip color={stale ? 'neutral' : report.status === 'CONFIRMED' ? 'rose' : report.status === 'RESOLVED' ? 'blue' : 'neutral'}>{label(report.status) + (stale ? ' · Stale' : '')}</Chip></TableCell><TableCell><OperationsTime value={report.observedAt} now={query.dataUpdatedAt}/></TableCell><TableCell><OperationsTime value={report.createdAt} now={query.dataUpdatedAt}/></TableCell><TableCell>{report.review.note}</TableCell><TableCell><div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={event => { review(report, 'CONFIRMED', event.currentTarget); }}>Confirm</Button><Button variant="secondary" onClick={() => {
                        void navigate('/overview');
                        if (!map)
                            return;
                        drawReport(map, report);
                    }}>Show on map</Button><Popover><MenuButton id={'more-' + report.id}>More actions</MenuButton><PopoverContent align="end"><div className="flex flex-col gap-2"><MenuAction disabled={pending} onAction={() => { review(report, 'REJECTED', document.getElementById('more-' + report.id) as HTMLButtonElement) }}>Reject</MenuAction><MenuAction disabled={pending} onAction={() => { review(report, 'RESOLVED', document.getElementById('more-' + report.id) as HTMLButtonElement) }}>Mark resolved</MenuAction></div></PopoverContent></Popover></div></TableCell></TableRow>;
            })}</TableBody></Table>}</Card>{(offset !== 0 || rows.length >= 50) && <div className="flex gap-2"><Button variant="secondary" disabled={offset === 0} onClick={() => { setMessage(null); setOffset(Math.max(0, offset - 50)); }}>Previous reports</Button><Button variant="secondary" disabled={rows.length < 50} onClick={() => { setMessage(null); setOffset(offset + 50); }}>Next reports</Button></div>}{dialog && <OpsDialog title={submitLabels[dialog.status]} context={label(dialog.report.kind) + ': ' + dialog.report.description} minNote={5} barrier={dialog.status === 'CONFIRMED' && dialog.report.kind !== 'SHELTER_CROWDING'} routes={null} submitLabel={submitLabels[dialog.status]} onClose={close} onSubmit={value => { void save(value); }}/>}</OperationsPage>;
}
