import { apiRequest, type ApiError } from '@/features/profile/api';

export type AlertItem = { id: string; level: 'waspada' | 'siaga' | 'awas'; hazardType: string; source: string; area: string | null; issuedAt: string | null; validUntil: string | null; latitude: number; longitude: number; myResponse: 'SAFE' | 'EVACUATING' | 'NEEDS_HELP' | null };
export type AlertsResponse = { items: AlertItem[]; location: { observedAt: string | null } };
export type AlertsOutcome = { status: 'ready'; data: AlertsResponse } | { status: 'no-location' };

export async function fetchAlerts(token: string): Promise<AlertsOutcome> {
  try {
    return { status: 'ready', data: await apiRequest<AlertsResponse>('/v1/alerts', token) };
  } catch (cause) {
    if ((cause as ApiError).status === 409 && (cause as Error).message === 'location required') return { status: 'no-location' };
    throw cause;
  }
}
