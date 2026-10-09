import type { AlertItem } from './api';

export const alertItems: AlertItem[] = [
  { id: 'rain', level: 'siaga', hazardType: 'EXTREME_WEATHER', source: 'BMKG', area: 'Example area', issuedAt: '2026-09-17T01:30:00Z', validUntil: '2026-09-17T04:30:00Z', latitude: -6.2665, longitude: 106.809, myResponse: null },
  { id: 'water', level: 'waspada', hazardType: 'FLOOD', source: 'PetaBencana', area: 'Example area', issuedAt: '2026-09-17T00:00:00Z', validUntil: null, latitude: -6.271, longitude: 106.812, myResponse: null },
];
