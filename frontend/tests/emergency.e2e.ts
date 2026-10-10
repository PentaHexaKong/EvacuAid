import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('a seeded Siaga warning interrupts launch and Safe confirms on Home', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  await expect(screen.getByRole('button', /^(Start evacuation|Mulai evakuasi)$/)).toBeVisible({ timeout: 180_000 });
  if (await screen.getByRole('button', 'Mulai evakuasi').count()) {
    await screen.getByRole('button', 'Tutup').tap();
    await agent.act('change the app language to English in the settings, then go back to the home screen');
    await app.restart();
  } else if (await screen.getByRole('button', 'Peringatan').count()) {
    await agent.act('change the app language to English in the settings, then go back to the home screen');
    await app.restart();
  }
  await expect(screen.getByRole('button', 'Start evacuation')).toBeVisible({ timeout: 180_000 });
  await screen.getByRole('button', "I'm safe").tap();
  if (await screen.getByRole('button', 'Not now').count()) await screen.getByRole('button', 'Not now').tap();
  await expect(screen.getByText('You marked yourself safe.')).toBeVisible();
});

test('a seeded warning with a primary Buddy sends help straight to the waiting state', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  await expect(screen.getByRole('button', /^(Start evacuation|Mulai evakuasi)$/)).toBeVisible({ timeout: 180_000 });
  if (await screen.getByRole('button', 'Mulai evakuasi').count()) {
    await screen.getByRole('button', 'Tutup').tap();
    await agent.act('change the app language to English in the settings, then go back to the home screen');
    await app.restart();
  }
  await screen.getByRole('button', /^Ask .+ for help\. Shares your location with .+$/).tap();
  await expect(screen.getByText('Waiting for a helper response')).toBeVisible();
  await expect(screen.getByRole('button', 'Cancel')).not.toBeVisible();
});
