import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('the Buddy tab switches between My Buddies and Nearby', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('button', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await expect(screen.getByRole('button', 'Alerts')).toBeVisible();

  await screen.getByRole('tab', 'Buddy').tap();
  await expect(screen.getByText('Need help now?')).toBeVisible();
  await screen.getByText('Nearby').tap();
  await expect(screen.getByRole('switch', 'I am available to help')).toBeVisible();
});
