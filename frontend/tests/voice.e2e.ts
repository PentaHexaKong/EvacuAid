import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('someone with a visual need gets a Home led by Speak, and Ask for help waits for a confirmation', { timeout: 480_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  await agent.act('open Profile, then Profile details, turn on "Visual impairment" (leave any other needs as they are), save the profile, and close the Profile sheet');
  await screen.getByRole('tab', 'Home').tap();

  // The simulator has no microphone input, so recognition itself is covered by the Jest tests; this walks the buttons that run the same actions.
  await expect(screen.getByRole('button', 'Speak')).toBeVisible();
  await expect(screen.getByRole('button', /^Read the alert aloud/)).toBeVisible();
  await expect(screen.getByRole('button', /^Nearest gathering point/)).toBeVisible();
  await expect(screen.getByText('Risk map')).not.toBeVisible();
  await app.screenshot('voice-home');

  await screen.getByRole('button', /^Ask for help/).tap();
  // Without a Buddy it says so and offers 112; with one it asks before sending. Either way nothing happens until a button is tapped.
  await expect(screen.getByRole('button', /^(Call 112|Confirm)$/)).toBeVisible({ timeout: 30_000 });
  await app.screenshot('ask-for-help-confirmation');
  await screen.getByRole('button', 'Cancel').tap();

  await screen.getByRole('tab', 'Buddy').tap();
  await expect(screen.getByText('Buddy status')).toBeVisible();
  await expect(screen.getByRole('button', 'Tap to speak')).toBeVisible();

  await agent.act('open Profile, then Profile details, turn off every accessibility need, save the profile, and close the Profile sheet');
  await screen.getByRole('tab', 'Home').tap();
  await expect(screen.getByRole('button', 'Speak')).not.toBeVisible();
});
