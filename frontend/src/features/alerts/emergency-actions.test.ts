import { emergencyActions } from './emergency-actions';

test.each([false, true].flatMap(voiceHome => [null, 'Sari'].flatMap(buddyName => [0, 2].map(relyingCount => ({ hasNeeds: true, voiceHome, buddyName, relyingCount })))))('support actions: %p', options => {
  expect(emergencyActions(options)).toEqual([{ id: 'buddy', variant: 'gradient' }, { id: 'evacuate', variant: 'secondary' }, { id: 'safe', variant: 'link' }]);
});
test.each([0, 2])('helper actions with %s relying people', relyingCount => {
  expect(emergencyActions({ hasNeeds: false, voiceHome: false, buddyName: null, relyingCount })).toEqual([{ id: 'evacuate', variant: 'gradient' }, { id: 'safe', variant: 'secondary' }, ...(relyingCount ? [{ id: 'checkPeople', variant: 'secondary' }] : []), { id: 'needHelp', variant: 'link' }]);
});
