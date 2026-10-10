import { incomingNamesSummary, orderRelyingContacts, relyingSummary } from './incoming-contacts';

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


const answer = (name: string, response?: 'SAFE' | 'EVACUATING' | 'NEEDS_HELP') => ({ name, latestAlertResponse: response ? { alertId: 'warning', response, at: '2026-10-10T00:00:00Z' } : null });

test('needs help takes priority over safe and evacuating answers', () => {
  expect(relyingSummary([answer('Ari', 'SAFE'), answer('Budi', 'NEEDS_HELP'), answer('Citra', 'EVACUATING')])).toEqual({ key: 'relyingDetailNeedsHelp', params: { name: 'Budi' }, tone: 'critical' });
});

test('safe summary includes only answered people and requires an answer', () => {
  expect(relyingSummary([answer('Ari', 'SAFE'), answer('Budi')])).toEqual({ key: 'relyingDetailAllSafe', params: { names: 'Ari' }, tone: 'neutral' });
  expect(relyingSummary([])).toEqual({ key: null, params: { names: '' }, tone: 'neutral' });
  expect(relyingSummary([answer('Ari')])).toEqual({ key: null, params: { names: 'Ari' }, tone: 'neutral' });
});

test('evacuating and mixed answers retain the existing names summary', () => {
  expect(relyingSummary([answer('Ari', 'SAFE'), answer('Budi', 'EVACUATING')])).toEqual({ key: null, params: { names: 'Ari, Budi' }, tone: 'neutral' });
});

test('row ordering is stable and does not mutate contacts', () => {
  const contacts = [answer('Safe', 'SAFE'), answer('None'), answer('Help1', 'NEEDS_HELP'), answer('Leaving', 'EVACUATING'), answer('Help2', 'NEEDS_HELP'), answer('None2')];
  expect(orderRelyingContacts(contacts).map(contact => contact.name)).toEqual(['Help1', 'Help2', 'Leaving', 'None', 'None2', 'Safe']);
  expect(contacts[0].name).toBe('Safe');
});
