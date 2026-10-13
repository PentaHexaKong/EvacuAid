import { useEffect, useState, type ReactNode } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import { useDataMode } from '@/app/data-mode';
import { PageHeader, PageHeaderTitle, PageHeaderSummary, PageHeaderAside, PageHeaderDescription } from '@/components/app/PageHeader';
import { Button } from '@/components/base/buttons/button';
import { Alert } from '@/components/app/primitives/alert';
import { operationsConnectionError } from '@/lib/queries';
export function label(value: string | null | undefined) {
    const text = (value ?? 'Unknown').toLowerCase().replaceAll('_', ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}
export function OperationsTime({ value, now }: {
    value?: string;
    now?: number;
}) {
    const [mountedAt] = useState(() => Date.now());
    const seconds = value ? (new Date(value).getTime() - (now ?? mountedAt)) / 1000 : NaN;
    let text = 'Unknown';
    if (Number.isFinite(seconds)) {
        const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
            if (Math.abs(seconds) >= size || unit === 'second') {
                text = relative.format(Math.round(seconds / size), unit);
                break;
            }
        }
    }
    return <time dateTime={value} title={value ? new Date(value).toLocaleString() : undefined}>{text}</time>;
}
export function OperationsPage({ title, intro, loading, error, receivedAt, message, refreshing, onRefresh, children }: {
    title: string;
    intro?: string;
    loading: boolean;
    error: Error | null;
    receivedAt: number;
    message?: string;
    refreshing: boolean;
    onRefresh: () => void;
    children: ReactNode;
}) {
    const { dataMode } = useDataMode();
    useEffect(() => { document.title = title + ' · EvacuAid Command Center'; }, [title]);
    const simulation = dataMode === 'SIMULATION';
    return <div className="flex min-w-0 flex-col gap-4"><PageHeader><PageHeaderSummary><PageHeaderTitle>{title}</PageHeaderTitle><p id="operations-message" role="status" className="text-body-regular text-foreground-light">{simulation ? 'SIMULATION: live cases and route publishing are hidden.' : error ? operationsConnectionError(error) : message || (loading ? 'Loading operational records' : <>{'Connected · last received '}<OperationsTime value={new Date(receivedAt).toISOString()} now={receivedAt}/>{'. Observations may be delayed. No live shelter occupancy is tracked.'}</>)}</p></PageHeaderSummary><PageHeaderAside><Button variant="secondary" leadingIcon={RiRefreshLine} disabled={refreshing || simulation} onClick={onRefresh}>Refresh operations</Button></PageHeaderAside></PageHeader>{!simulation && <>{intro && <PageHeaderDescription>{intro}</PageHeaderDescription>}{error && <Alert variant="destructive">{operationsConnectionError(error)}</Alert>}{children}</>}</div>;
}
