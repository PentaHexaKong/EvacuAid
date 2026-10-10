import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

// Needs a profile with at least one support need: that is what makes the Buddy tab show the ask-for-help page.
test('a person with support needs can ask for help and open Add Buddy', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await expect(screen.getByRole('tab', 'Alerts')).toBeVisible();

  await screen.getByRole('tab', 'Buddy').tap();
  await expect(screen.getByText('Need help now?')).toBeVisible();
  // Asking only goes out after the confirmation, so opening and cancelling it sends nothing.
  await screen.getByRole('button', 'Find help nearby').tap();
  await expect(screen.getByText('Find help nearby?')).toBeVisible();
  await screen.getByRole('button', 'Cancel').tap();

  // The toolbar button and, with no Buddy yet, the ask block both open the sheet.
  await screen.getByRole('button', 'Add Buddy').first().tap();
  await expect(screen.getByText('Your code')).toBeVisible();
  await expect(screen.getByText('Enter the code of someone you trust. They have to accept first.')).toBeVisible();
});
