import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

// Needs a profile without support needs: that is what makes the Buddy tab show the helper page.
test('a helper sees their friends, auto search, and the Add Buddy sheet', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('button', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await expect(screen.getByRole('button', 'Alerts')).toBeVisible();

  await screen.getByRole('tab', 'Buddy').tap();
  await expect(screen.getByText('Help others')).toBeVisible();
  await screen.getByText('Auto search').tap();
  await agent.waitFor('the screen shows either a switch to be available to help, or a card explaining that auto search turns on once someone accepts you as their Buddy');
  await screen.getByText('Added friends').tap();

  await screen.getByRole('button', 'Add Buddy').tap();
  await expect(screen.getByText('Your Buddy code')).toBeVisible();
  await screen.getByRole('textbox', 'Invitation code').fill('ZZZZ-ZZZZ');
  // The keyboard covers the Send button in the sheet, so submit from the keyboard as a user would.
  await screen.getByRole('textbox', 'Invitation code').press('Enter');
  await expect(screen.getByText('Code not found. Check it and try again.')).toBeVisible();
});
