import { apiRequest, type ApiError } from '@/features/profile/api';

export type AlertItem = { id: string; level: 'waspada' | 'siaga' | 'awas'; hazardType: string; source: string; simulation?: boolean; area: string | null; issuedAt: string | null; validUntil: string | null; latitude: number; longitude: number; myResponse: 'SAFE' | 'EVACUATING' | 'NEEDS_HELP' | null };
export type AlertsResponse = { items: AlertItem[]; location: { observedAt: string | null } };
export type AlertsOutcome = { status: 'ready'; data: AlertsResponse } | { status: 'no-location' };

export async function respondToAlert(token: string, id: string, response: NonNullable<AlertItem['myResponse']>): Promise<AlertItem> {
  return apiRequest<AlertItem>(`/v1/alerts/${encodeURIComponent(id)}/response`, token, { method: 'POST', body: JSON.stringify({ response }) });
}

export async function fetchAlerts(token: string): Promise<AlertsOutcome> {
  try {
    return { status: 'ready', data: await apiRequest<AlertsResponse>('/v1/alerts', token) };
  } catch (cause) {
    if ((cause as ApiError).status === 409 && (cause as Error).message === 'location required') return { status: 'no-location' };
    throw cause;
  }
}

// Development builds only: the backend serves these when PILOT_DEV_SIMULATION=1.
export const simulateAlert = (token: string, body: { level: AlertItem['level']; hazard: string }) => apiRequest<AlertItem>('/v1/alerts/dev/simulate', token, { method: 'POST', body: JSON.stringify(body) });
export const clearSimulatedAlerts = (token: string) => apiRequest<void>('/v1/alerts/dev/simulate', token, { method: 'DELETE' });
