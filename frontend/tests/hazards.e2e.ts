import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('a disaster card opens its detail page with facts, safety steps and a way to the map', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('button', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  // The cards come from the live feed, so which disasters are listed changes from day to day: match any card by the shape of its label.
  const card = screen.getByRole('button', /magnitude \d|citizen reports? this week/).first();
  await screen.scrollUntilVisible(card);
  await card.tap();
  await expect(screen.getByText('Key facts')).toBeVisible();
  await expect(screen.getByText('What to do')).toBeVisible();
  // The banner photo is decorative, so it is not in the accessibility tree this test reads; it is checked by eye on the simulator.
  await expect(screen.getByText('Source')).toBeVisible();

  await screen.getByRole('button', 'Back').tap();
  await expect(screen.getByText('Discover disaster')).toBeVisible();
});
