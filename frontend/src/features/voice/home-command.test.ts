import { homeCommand } from './home-command';

test.each([
  ['Help me', 'help'], ['tolong saya', 'help'], ['minta bantuan', 'help'],
  ['tolong, di mana titik kumpul terdekat', 'help'],
  ['nearest gathering point', 'nearest'], ['titik kumpul terdekat', 'nearest'], ['where is the shelter', 'nearest'],
  ['read the alert', 'readAlert'], ['Baca peringatan', 'readAlert'],
  ['what time is it', null], ['', null],
] as const)('%s → %s', (transcript, expected) => {
  expect(homeCommand(transcript)).toBe(expected);
});
