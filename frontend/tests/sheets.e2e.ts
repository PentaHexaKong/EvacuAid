import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('the Profile sheet closes from its navigation bar and a warning opens from the Alerts tab', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  await screen.getByRole('button', 'Profile').tap();
  await expect(screen.getByText('Account information')).toBeVisible();
  await screen.getByRole('button', 'Close').tap();
  await expect(screen.getByText('Account information')).toBeHidden();

  // Alerts is a tab now; a warning opens as a pushed page with the native back button.
  await screen.getByRole('tab', 'Alerts').tap();
  await screen.getByRole('button', /^(Caution|Alert|Danger)\. /).first().tap();
  await expect(screen.getByText('Warning content')).toBeVisible();
  await screen.getByRole('button', 'Back').tap();
  await expect(screen.getByText('Warning content')).toBeHidden();
});
