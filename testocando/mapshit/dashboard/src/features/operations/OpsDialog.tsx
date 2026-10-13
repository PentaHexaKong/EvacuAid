import { useRef, useState } from 'react';
import { FormDialog, FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader, FormDialogTitle } from '@/components/app/FormDialog';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { InputBase, TextField } from '@/components/base/input/input';
import { Label } from '@/components/base/input/label';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/app/primitives/textarea';
import { Alert } from '@/components/app/primitives/alert';
import type { OperationalRoute } from '@/lib/types';
export type OpsValue = {
    note: string;
    barrier: boolean;
    radiusM: number;
    validUntil: string | null;
    assignedRouteId: string | null;
};
export type OpsDialogProps = {
    title: string;
    context: string;
    minNote: number;
    barrier: boolean;
    routes: OperationalRoute[] | null;
    submitLabel: string;
    initialRouteId?: string | null;
    routeRequired?: boolean;
    onClose: () => void;
    onSubmit: (value: OpsValue) => void;
};
export function OpsDialog({ title, context, minNote, barrier, routes, submitLabel, initialRouteId, routeRequired = false, onClose, onSubmit }: OpsDialogProps) {
    const [note, setNote] = useState('');
    const [hardBarrier, setHardBarrier] = useState(false);
    const [radius, setRadius] = useState('30');
    const [hours, setHours] = useState('2');
    const [routeId, setRouteId] = useState(initialRouteId ?? '');
    const [error, setError] = useState('');
    const noteRef = useRef<HTMLTextAreaElement>(null);
    return <FormDialog open onOpenChange={open => { if (!open)
        onClose(); }}><FormDialogContent aria-describedby="ops-dialog-context"><FormDialogHeader><FormDialogTitle>{title}</FormDialogTitle></FormDialogHeader><form className="flex min-h-0 flex-col gap-4" onInvalid={event => { setError((event.target as HTMLInputElement).validationMessage); }} onSubmit={event => {
            event.preventDefault();
            setError('');
            const trimmed = note.trim();
            const radiusM = barrier && hardBarrier ? Number(radius) : 30;
            if (trimmed.length < minNote || trimmed.length > 500) {
                setError('Enter a note of ' + String(minNote) + '–500 characters.');
                noteRef.current?.focus();
                return;
            }
            if (barrier && hardBarrier && (!Number.isFinite(radiusM) || radiusM < 5 || radiusM > 2000 || !Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 24)) {
                setError('Use a radius of 5–2000 metres and a validity greater than 0 and at most 24 hours.');
                return;
            }
            if (routes !== null && ((routeRequired && !routeId) || (routeId && !routes.some(route => route.id === routeId && route.usable)))) {
                setError('Choose a current published route.');
                return;
            }
            onSubmit({ note: trimmed, barrier: barrier && hardBarrier, radiusM, validUntil: barrier && hardBarrier ? new Date(Date.now() + Number(hours) * 3600000).toISOString() : null, assignedRouteId: routes === null ? null : routeId || null });
        }}><FormDialogBody animateResize={false}><p id="ops-dialog-context">{context}</p><div className="flex flex-col gap-2"><label htmlFor="ops-note">Note (public operational text; leave out personal information)</label><Textarea id="ops-note" ref={noteRef} autoFocus required minLength={minNote} maxLength={500} rows={4} aria-describedby="ops-note-count" value={note} onChange={event => { setNote(event.target.value); }}/><p id="ops-note-count" aria-live="polite">{note.length}/500</p></div>{barrier && <fieldset className="flex flex-col gap-4"><Checkbox isSelected={hardBarrier} onChange={setHardBarrier}>Responders verified this is a hard evacuation barrier (published routes will be invalidated)</Checkbox>{hardBarrier && <div className="grid gap-4 sm:grid-cols-2"><TextField isRequired value={radius} onChange={setRadius}><Label>Barrier radius (m)</Label><InputBase type="number" min={5} max={2000}/></TextField><TextField isRequired value={hours} onChange={setHours}><Label>Valid for (hours)</Label><InputBase type="number" min={0.5} max={24} step="0.5"/></TextField></div>}</fieldset>}{routes !== null && <div><span id="ops-route-label">Published route</span><Select aria-labelledby="ops-route-label" placeholder="Choose published route" isRequired={routeRequired} value={routeId || null} onChange={key => { setRouteId(String(key ?? '')); }}><SelectItem id="">Choose published route</SelectItem>{routes.map(route => <SelectItem key={route.id} id={route.id}>{route.name}</SelectItem>)}</Select></div>}{error && <Alert variant="destructive">{error}</Alert>}</FormDialogBody><FormDialogFooter><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">{submitLabel}</Button></FormDialogFooter></form></FormDialogContent></FormDialog>;
}
