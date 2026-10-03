import { apiRequest } from '@/features/profile/api';

export type HazardType = 'earthquake' | 'flood' | 'volcano' | 'haze' | 'fire' | 'wind';
export type HazardItem = { id: string; type: HazardType; occurredAt: string; source: 'BMKG' | 'PetaBencana'; latitude: number | null; longitude: number | null; magnitude: number | null; depthKm: number | null; region: string | null; felt: string | null; reportCount: number | null };
export type HazardsResponse = { items: HazardItem[]; sources: Record<string, { status: 'available' | 'unavailable'; error: string | null }> };

export const fetchRecentHazards = (token: string) => apiRequest<HazardsResponse>('/v1/hazards/recent', token);
