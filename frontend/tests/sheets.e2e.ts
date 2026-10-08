import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('the Profile and Alerts sheets open under their navigation bar and close from it', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('button', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  await screen.getByRole('button', 'Profile').tap();
  await expect(screen.getByText('Account information')).toBeVisible();
  await screen.getByRole('button', 'Close').tap();
  await expect(screen.getByText('Account information')).toBeHidden();

  await screen.getByRole('button', 'Alerts').tap();
  await expect(screen.getByRole('button', 'Close')).toBeVisible();
  // A pushed page keeps Close and gains the native back button, which returns to the list inside the sheet.
  await screen.getByRole('button', 'Caution. Heavy rain and strong winds. South Jakarta. 17 Sep 2026 · 08:30 WIB').tap();
  await expect(screen.getByText('Warning content')).toBeVisible();
  await screen.getByRole('button', 'Back').tap();
  await expect(screen.getByText('Warning content')).toBeHidden();
  await screen.getByRole('button', 'Close').tap();
  await expect(screen.getByRole('button', 'Close')).toBeHidden();
});
