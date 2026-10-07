export const sampleAlerts = [
  { id: 'rain', level: 'waspada', steps: ['rainStep1', 'rainStep2', 'rainStep3'], coordinate: { latitude: -6.2665, longitude: 106.809 }, title: 'rainTitle', summary: 'rainSummary', body: 'rainBody', severity: 'cautionLabel', window: 'rainWindow', issued: '17 Sep 2026 · 08:30 WIB', validity: 'rainValidity', area: 'exampleArea' },
  { id: 'water', level: 'normal', steps: [], coordinate: { latitude: -6.271, longitude: 106.812 }, title: 'waterTitle', summary: 'waterSummary', body: 'waterBody', severity: 'infoLabel', window: null, issued: '17 Sep 2026 · 07:00 WIB', validity: 'waterValidity', area: 'exampleArea' },
] as const;

export const levelLabels = { normal: 'levelNormal', waspada: 'levelWaspada', siaga: 'levelSiaga', awas: 'levelAwas' } as const;

export const topAlert = sampleAlerts.reduce((top, alert) => Object.keys(levelLabels).indexOf(alert.level) > Object.keys(levelLabels).indexOf(top.level) ? alert : top);
