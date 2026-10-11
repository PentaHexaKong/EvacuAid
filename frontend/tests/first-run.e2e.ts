import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('replaying the guide returns to the welcome screen, where the language menu switches the app', { timeout: 480_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await agent.waitFor('the app has finished loading and shows either its tab bar or the welcome screen', { timeout: 180_000 });
  // A run that stopped half way leaves the guide open, so only replay it from the app.
  if (await screen.getByRole('tab', 'Buddy').count()) {
    // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
    if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
    // The account stays signed in; only the guide starts again.
    await agent.act('open Profile, scroll to "Replay guide" and tap it, so the welcome screen opens');
  }
  await expect(screen.getByText('Warnings that adapt to you.')).toBeVisible({ timeout: 60_000 });
  await app.screenshot('welcome-after-replay');

  // The menu names the current language, and each option is written in its own language.
  await expect(screen.getByRole('button', /^Language, English/)).toBeVisible();
  await agent.act('open the language menu at the top of the screen and choose "Bahasa Indonesia"');
  await expect(screen.getByText('Peringatan yang menyesuaikan kebutuhanmu.')).toBeVisible();
  await expect(screen.getByRole('button', /^Bahasa, Bahasa Indonesia/)).toBeVisible();
  await app.screenshot('welcome-indonesian');
  await agent.act('open the language menu at the top of the screen and choose "English"');
  await expect(screen.getByText('Warnings that adapt to you.')).toBeVisible();

  await screen.getByRole('button', 'Get started').tap();
  // The support step is taller than the screen.
  await screen.scrollUntilVisible(screen.getByRole('button', 'Continue'));
  await screen.getByRole('button', 'Continue').tap();
  await screen.getByRole('button', 'Continue').tap();
  await expect(screen.getByText('Stay reachable in an emergency')).toBeVisible();
  await screen.getByRole('button', 'Not now').tap();
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 60_000 });
  await app.screenshot('home-after-guide');
});
