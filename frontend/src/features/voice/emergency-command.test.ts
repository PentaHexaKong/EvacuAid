import { emergencyCommand } from './emergency-command';

test.each([['tolong saya', 'help'], ['bantu saya pergi', 'help'], ['help me go', 'help'], ['SOS', 'help'], ['go now', 'evacuate'], ['mulai evakuasi', 'evacuate'], ['pergi', 'evacuate'], ['berangkat sekarang', 'evacuate'], ['start evacuation', 'evacuate'], ['saya aman', 'safe'], ["I'm safe", 'safe'], ['sudah selamat', 'safe'], ['hello', null], ['gondola', null]])('%s → %s', (text, command) => {
  expect(emergencyCommand(text)).toBe(command);
});
