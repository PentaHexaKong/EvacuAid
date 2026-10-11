import { test } from '@e2e-dev/mobile';
import { credentials, expect } from 'e2e';

// Needs E2E_ACCOUNT_PASSWORD for an account that already exists on the backend the app points at.
test('signing out returns to sign-in, and signing in opens the app', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  const tester = credentials.user('tester');
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch; it then shows the app or the sign-in form.
  await agent.waitFor('the app has finished loading and shows either its tab bar or a sign-in form', { timeout: 180_000 });
  if (await screen.getByRole('tab', 'Buddy').count()) {
    // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
    if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
    await agent.act('open Profile from the Home screen, scroll to the bottom, tap "Sign out" (or "Log out") and confirm it');
  }
  await expect(screen.getByRole('button', 'Sign in')).toBeVisible({ timeout: 60_000 });
  // The keyboard covers the lower half of the form, so close it after each field; return in the password field submits.
  await screen.getByLabel('Email').fill(tester.username);
  await screen.getByLabel('Email').press('Enter');
  await screen.getByLabel('Password').fill(tester.password);
  await screen.getByLabel('Password').press('Enter');
  // iOS may offer to save the password, and its dialog hides the app from the screen reader tree until it is answered.
  const notNow = screen.getByRole('button', 'Not Now');
  if (await expect(notNow).toBeVisible({ timeout: 8_000 }).then(() => true, () => false)) await notNow.tap();
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 60_000 });
});
