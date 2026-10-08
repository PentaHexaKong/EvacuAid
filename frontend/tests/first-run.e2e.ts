import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('deleting the profile returns to the welcome screen, where the language menu switches the app', { timeout: 480_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('button', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  // This deletes the simulator's guest profile; the test ends on a new one.
  await agent.act('open Profile, scroll to "Delete profile", tap it, and confirm the deletion in the alert');
  // Setup, not the "session could not be restored" error.
  await expect(screen.getByText('Warnings that adapt to you.')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText('New guest profile')).not.toBeVisible();
  await app.screenshot('welcome-after-delete');

  // The menu names the current language, and each option is written in its own language.
  await expect(screen.getByRole('button', /^Language, English/)).toBeVisible();
  await agent.act('open the language menu at the top of the screen and choose "Bahasa Indonesia"');
  await expect(screen.getByText('Peringatan yang menyesuaikan kebutuhanmu.')).toBeVisible();
  await expect(screen.getByRole('button', /^Bahasa, Bahasa Indonesia/)).toBeVisible();
  await app.screenshot('welcome-indonesian');
  await agent.act('open the language menu at the top of the screen and choose "English"');
  await expect(screen.getByText('Warnings that adapt to you.')).toBeVisible();

  await screen.getByRole('button', 'Skip setup').tap();
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 60_000 });
  await app.screenshot('home-new-guest');
});
