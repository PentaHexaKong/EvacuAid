export const sampleAlerts = [
  { id: 'rain', level: 'waspada', steps: ['rainStep1', 'rainStep2', 'rainStep3'], coordinate: { latitude: -6.2665, longitude: 106.809 }, title: 'rainTitle', summary: 'rainSummary', body: 'rainBody', severity: 'cautionLabel', window: 'rainWindow', issued: '17 Sep 2026 · 08:30 WIB', validity: 'rainValidity', area: 'exampleArea' },
  { id: 'water', level: 'normal', steps: [], coordinate: { latitude: -6.271, longitude: 106.812 }, title: 'waterTitle', summary: 'waterSummary', body: 'waterBody', severity: 'infoLabel', window: null, issued: '17 Sep 2026 · 07:00 WIB', validity: 'waterValidity', area: 'exampleArea' },
] as const;

export const sampleContacts = [
  { id: 'raka', name: 'Raka Pratama', initials: 'RP', relationship: 'friendLabel' },
  { id: 'sinta', name: 'Sinta Nuraini', initials: 'SN', relationship: 'familyLabel' },
] as const;

export const levelLabels = { normal: 'levelNormal', waspada: 'levelWaspada', siaga: 'levelSiaga', awas: 'levelAwas' } as const;
