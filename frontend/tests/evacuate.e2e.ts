import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('Discover starts solo guidance to a gathering point', { timeout: 480_000 }, async ({ app, agent, screen }) => {
  await app.open();
  await expect(screen.getByRole('tab', 'Home')).toBeVisible({ timeout: 180_000 });
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  if (!await screen.getByRole('tab', 'Discover').count()) await agent.act('open Profile, then Profile details, turn off every accessibility need, save the profile, and close the Profile sheet');
  await screen.getByRole('tab', 'Discover').tap();
  await agent.act('find a walking route to a safe gathering point (the app may skip the nearest one when it is inside a danger zone), allowing location access if asked');
  await expect(screen.getByRole('button', 'Start guidance')).toBeVisible({ timeout: 60_000 });
  await screen.getByRole('button', 'Start guidance').tap();
  await expect(screen.getByText(/^To .+/)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole('button', "I've arrived, I'm safe")).toBeVisible();
  await app.screenshot('solo-evacuation-guidance');
  await screen.getByRole('button', 'Stop guidance').tap();
  await screen.getByRole('button', 'Stop').tap();
});
