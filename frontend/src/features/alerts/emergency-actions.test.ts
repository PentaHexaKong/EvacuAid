import { emergencyActions } from './emergency-actions';

test.each([null, 'Sari'].flatMap(buddyName => [0, 2].map(relyingCount => ({ hasNeeds: true, voiceHome: false, buddyName, relyingCount }))))('support actions: %p', options => {
  expect(emergencyActions(options)).toEqual([{ id: 'buddy', variant: 'gradient' }, { id: 'evacuate', variant: 'secondary' }, { id: 'safe', variant: 'link' }]);
});
// Blind and low-vision people are guided to the gathering point first; every answer is a full-size button, never a text link.
test.each([null, 'Sari'])('voice-first actions with buddy %p', buddyName => {
  expect(emergencyActions({ hasNeeds: true, voiceHome: true, buddyName, relyingCount: 0 })).toEqual([{ id: 'evacuate', variant: 'gradient' }, { id: 'buddy', variant: 'secondary' }, { id: 'safe', variant: 'secondary' }]);
});
test.each([0, 2])('helper actions with %s relying people', relyingCount => {
  expect(emergencyActions({ hasNeeds: false, voiceHome: false, buddyName: null, relyingCount })).toEqual([{ id: 'evacuate', variant: 'gradient' }, { id: 'safe', variant: 'secondary' }, ...(relyingCount ? [{ id: 'checkPeople', variant: 'secondary' }] : []), { id: 'needHelp', variant: 'link' }]);
});
