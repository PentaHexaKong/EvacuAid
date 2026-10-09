import { incomingNamesSummary } from './incoming-contacts';

test.each([
  { names: [], summary: '' },
  { names: ['Ari'], summary: 'Ari' },
  { names: ['Ari', 'Budi'], summary: 'Ari, Budi' },
  { names: ['Ari', 'Budi', 'Citra'], summary: 'Ari, Budi, +1' },
  { names: ['Ari', 'Budi', 'Citra', 'Dewi'], summary: 'Ari, Budi, +2' },
  { names: [null, '', '  '], summary: '' },
  { names: [null, ' Ari ', 'Budi'], summary: 'Ari, Budi' },
])('summarizes $names', ({ names, summary }) => {
  expect(incomingNamesSummary(names.map(name => ({ name })))).toBe(summary);
});
