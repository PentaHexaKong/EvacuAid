export const sampleAlerts = [
  { id: 'rain', coordinate: { latitude: -6.2665, longitude: 106.809 }, title: 'rainTitle', summary: 'rainSummary', body: 'rainBody', severity: 'cautionLabel', issued: '17 Sep 2026 · 08:30 WIB', validity: 'rainValidity', area: 'exampleArea', source: 'sampleSource' },
  { id: 'water', coordinate: { latitude: -6.271, longitude: 106.812 }, title: 'waterTitle', summary: 'waterSummary', body: 'waterBody', severity: 'infoLabel', issued: '17 Sep 2026 · 07:00 WIB', validity: 'waterValidity', area: 'exampleArea', source: 'sampleSource' },
] as const;

export const sampleContacts = [
  { id: 'raka', name: 'Raka Pratama', initials: 'RP', relationship: 'friendLabel' },
  { id: 'sinta', name: 'Sinta Nuraini', initials: 'SN', relationship: 'familyLabel' },
] as const;

export const sampleDestinations = [
  { id: 'community-hall', coordinate: { latitude: -6.264, longitude: 106.814 }, name: 'hallName', address: 'hallAddress', access: 'hallAccess' },
  { id: 'community-center', coordinate: { latitude: -6.269, longitude: 106.805 }, name: 'centerName', address: 'centerAddress', access: 'centerAccess' },
] as const;
