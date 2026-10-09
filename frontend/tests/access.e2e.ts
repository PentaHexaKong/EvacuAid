import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('an older adult with a mobility need gets a simpler Home and step-free safety steps', { timeout: 420_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');

  await agent.act('open Profile, then Profile details, turn on "Older adult" and "Mobility limitation" (leave any other needs as they are), save the profile, and close the Profile sheet');

  // Simpler Home: other alerts and recent disasters wait behind one disclosure row.
  const more = screen.getByRole('button', /^More information/);
  await expect(more).toBeVisible();
  await expect(screen.getByText('Discover disaster')).not.toBeVisible();
  await more.tap();
  // iOS exposes accessibilityState.expanded as the element's value.
  await expect(more).toHaveValue('expanded');
  await screen.scrollUntilVisible(screen.getByText('Discover disaster'));

  // Safety steps are worded for someone who cannot drop to the floor or use stairs.
  const card = screen.getByRole('button', /^Earthquake, magnitude \d/).first();
  await screen.scrollUntilVisible(card);
  await card.tap();
  await screen.scrollUntilVisible(screen.getByText(/lock your wheels or sit down/));
  await screen.getByRole('button', 'Back').tap();

  await agent.act('open Profile, then Profile details, turn off every accessibility need, save the profile, and close the Profile sheet');
  await expect(screen.getByRole('button', /^More information/)).not.toBeVisible();
});

test('a blind profile has Alerts and no Discover tab', { timeout: 420_000 }, async ({ app, agent, screen }) => {
  await app.open();
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await agent.act('open Profile, then Profile details, turn off every accessibility need except "Visual impairment", turn on "Visual impairment", save the profile, and close the Profile sheet');
  await expect(screen.getByRole('tab', 'Discover')).not.toBeVisible();
  await expect(screen.getByRole('tab', 'Alerts')).toBeVisible();
  await screen.getByRole('tab', 'Alerts').tap();
  await expect(screen.getByText('Alerts').last()).toBeVisible();
  await screen.getByRole('tab', 'Home').tap();
  await agent.act('open Profile, then Profile details, turn off every accessibility need, save the profile, and close the Profile sheet');
  await expect(screen.getByText('Discover')).toBeVisible();
});
