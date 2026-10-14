import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { z } from 'zod';

// Needs a profile without support needs: that is what makes the Buddy tab show the helper page.
test('a helper sees their friends, auto search, and the Add Buddy sheet', { timeout: 300_000 }, async ({ app, agent, screen }) => {
  await app.open();
  // A dev build downloads its bundle from Metro on every fresh launch.
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 180_000 });
  // A saved language preference wins over the device language, so switch it in the app when it is not English yet.
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await expect(screen.getByRole('tab', 'Alerts')).toBeVisible();

  await screen.getByRole('tab', 'Buddy').tap();
  await expect(screen.getByText('Help others')).toBeVisible();
  await screen.getByText('Auto search').tap();
  await agent.waitFor('the screen shows either a switch to be available to help, or a card explaining that auto search turns on once someone accepts you as their Buddy');
  await screen.getByText('Added friends').tap();

  // With no friends yet the empty state offers Add Buddy too; either one opens the sheet.
  await screen.getByRole('button', 'Add Buddy').first().tap();
  await expect(screen.getByText('Your code')).toBeVisible();
  await screen.getByRole('textbox', 'Invitation code').fill('ZZZZ-ZZZZ');
  // The keyboard covers the Send button in the sheet, so submit from the keyboard as a user would.
  await screen.getByRole('textbox', 'Invitation code').press('Enter');
  await expect(screen.getByText('Code not found. Check it and try again.')).toBeVisible();
});

// A second person is played through the API: they add the helper by code, ask for help and share a location.
// The helper starts near South Jakarta, inside the area the routing tiles cover, and walks toward the friend.
const API = process.env.E2E_API_URL ?? 'http://localhost:8000';
const call = async (token: string, path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${API}/v1/buddy${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

test('a helper accepts a friend and is guided to them turn by turn', { timeout: 420_000 }, async ({ app, agent, screen, device }) => {
  await device.setPermission('location', 'grant');
  // A fixed simulated location keeps its first timestamp and the server rightly refuses it as stale, so the helper takes a step
  // before each moment a fresh position matters. Between actions, never alongside them: the runner takes one command at a time.
  let step = 0;
  const walk = () => device.setLocation({ latitude: -6.2615 - step * 0.00004, longitude: 106.8106 - (step++) * 0.00006 });
  await walk();
  await app.open();
  await expect(screen.getByRole('tab', 'Buddy')).toBeVisible({ timeout: 180_000 });
  if (await screen.getByRole('tab', 'Peringatan').count()) await agent.act('change the app language to English in the settings, then go back to the home screen');
  await screen.getByRole('tab', 'Buddy').tap();
  const { code } = await agent.extract('the Buddy code shown under "Your code", in the form XXXX-XXXX', { schema: z.object({ code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }) });

  const guest = await (await fetch(`${API}/v1/guest-sessions`, { method: 'POST' })).json();
  const friend: string = guest.access_token;
  await fetch(`${API}/v1/users/${guest.user.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${friend}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nina Rahma', accessibility: [{ type: 'VISUAL_IMPAIRMENT' }] }) });
  let requestId: string | undefined;
  let sharing: ReturnType<typeof setInterval> | undefined;
  try {
    const invitation = await call(friend, '/invitations/direct', 'POST', { code, relation: 'TEMAN', direction: 'SEEK_HELP' });
    // The page reloads when it regains focus.
    await screen.getByRole('tab', 'Home').tap();
    await screen.getByRole('tab', 'Buddy').tap();
    await expect(screen.getByText('Wants to add you')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Accept').tap();
    await expect(screen.getByText('Wants to add you')).toBeHidden({ timeout: 30_000 });

    const request = await call(friend, '/requests', 'POST', { helperUserId: invitation.redeemerUserId, message: 'Please walk with me to the gathering point', supportNeeds: [], sharingConsent: true, idempotencyKey: `e2e-${Date.now()}`, latitude: -6.266, longitude: 106.804 });
    requestId = request.id;
    // The takeover arrives on its own. Tapping tabs while waiting can land on its buttons as it slides in.
    await expect(screen.getByText('Nina Rahma needs your help')).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByText('Shares your location with Nina Rahma while you help')).toBeVisible();
    // Its actions ignore touches for the first 600 ms after it appears.
    await new Promise(resolve => setTimeout(resolve, 1000));
    await screen.getByRole('button', "I'll help Nina Rahma").tap();
    await expect(screen.getByRole('button', 'Start travelling to requester')).toBeVisible({ timeout: 30_000 });

    // A phone keeps sending its position; one ping would go stale before the route is asked for.
    const share = () => call(friend, `/requests/${requestId}/location`, 'PUT', { latitude: -6.266, longitude: 106.804, accuracyM: 8, observedAt: new Date().toISOString(), sharingConsent: true, sharingVersion: 0 });
    await share();
    sharing = setInterval(() => { void share().catch(() => {}); }, 8_000);
    // Waiting for the takeover can outlast the first position, so the helper takes another step before the map is expected.
    await walk();
    // The session moves from the inline view to the map once the helper's own position arrives; tap after that, not during.
    await expect(screen.getByRole('button', 'Center map on my location')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Route to Nina')).toBeVisible();
    await walk();
    await screen.getByRole('button', 'Start travelling to requester').tap();
    await expect(screen.getByRole('button', 'Overview')).toBeVisible({ timeout: 45_000 });
    await agent.assert('a dark banner at the top shows a distance and a walking instruction, and the panel at the bottom shows minutes left with an arrival time');
    await screen.getByRole('button', 'Overview').tap();
    await expect(screen.getByRole('button', 'I have arrived')).toBeVisible();
    await expect(screen.getByText('Help others')).toBeVisible();
  } finally {
    clearInterval(sharing);
    if (requestId) await call(friend, `/requests/${requestId}/interrupt`, 'POST', {}).catch(() => {});
    const contacts: { id: string }[] = await call(friend, '/contacts').catch(() => []);
    for (const contact of contacts) await call(friend, `/contacts/${contact.id}`, 'DELETE').catch(() => {});
  }
});

// The dev-build prototype card walks both people to a safe house about 300 m away, then the friend confirms they are safe.
// No simulated location, so it also runs on a cabled iPhone (E2E_DEVICE).
test('a linked helper and friend walk to a safe house and the friend confirms they are safe', { timeout: 480_000 }, async ({ app, agent, screen, device }) => {
  // A real iPhone's tab bar exposes no tab items to automation, so screens open by deep link.
  const go = (path: string) => device.openLink(`evacuaid://${path}`);
  await app.open();
  await expect(screen.getByRole('button', /Profil/)).toBeVisible({ timeout: 180_000 });
  if (await screen.getByText('Areamu').count()) {
    await go('settings');
    await agent.act('change the app language to English');
  }
  await go('buddy');
  // An earlier run can leave its ended session on screen.
  if (await screen.getByRole('button', 'Back to Buddy').count()) await screen.getByRole('button', 'Back to Buddy').tap();
  // With no friends yet the code sits in the empty state, without its "Your code" heading.
  const code = (await screen.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).first().textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const guest = await (await fetch(`${API}/v1/guest-sessions`, { method: 'POST' })).json();
  const friend: string = guest.access_token;
  await fetch(`${API}/v1/users/${guest.user.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${friend}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nina Rahma', accessibility: [{ type: 'VISUAL_IMPAIRMENT' }] }) });
  let requestId: string | undefined;
  try {
    const invitation = await call(friend, '/invitations/direct', 'POST', { code, relation: 'TEMAN', direction: 'SEEK_HELP' });
    // The page reloads when it regains focus.
    await go('');
    await go('buddy');
    await expect(screen.getByText('Wants to add you')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Accept').tap();
    await expect(screen.getByText('Wants to add you')).toBeHidden({ timeout: 30_000 });

    const request = await call(friend, '/requests', 'POST', { helperUserId: invitation.redeemerUserId, message: 'Please walk with me to the gathering point', supportNeeds: [], sharingConsent: true, idempotencyKey: `e2e-${Date.now()}`, latitude: -6.266, longitude: 106.804 });
    requestId = request.id;
    // Live updates over a phone's network can lag, so reload the page rather than wait on them.
    await go('');
    await go('buddy');
    // The request arrives as the full-screen takeover or, after a reload, as a card on the Buddy page.
    const help = screen.getByRole('button', /^(I'll help Nina Rahma|Accept & help)$/);
    await expect(help).toBeVisible({ timeout: 90_000 });
    // The takeover's actions ignore touches for the first 600 ms after it appears.
    await new Promise(resolve => setTimeout(resolve, 1000));
    await help.tap();
    // Accepting from the card asks to confirm sharing location first.
    const consent = screen.getByRole('button', 'Confirm');
    if (await consent.count()) await consent.tap();

    // The link indicator says who is helping whom and how far along the session is.
    // VoiceOver reads it as one line, so it is one node.
    await expect(screen.getByLabel('Nina Rahma. Linked · you are helping. Step 1 of 4 · On the way').first()).toBeVisible({ timeout: 30_000 });

    await agent.act('tap "Simulate walking to a safe house (300 m)" in the Prototype card, scrolling the panel if needed');
    await expect(screen.getByLabel('Nina Rahma. Linked · you are helping. Step 3 of 4 · Heading to the gathering point together').first()).toBeVisible({ timeout: 15_000 });
    await agent.assert('the map shows a route line, a destination pin, and two person markers next to each other');
    // About 36 s of simulated walking.
    await expect(screen.getByText('You have reached the gathering point')).toBeVisible({ timeout: 90_000 });
    await expect(screen.getByLabel('Nina Rahma. Linked · you are helping. Step 4 of 4 · At the gathering point').first()).toBeVisible();
    await expect(screen.getByText('Waiting for Nina to confirm they are safe')).toBeVisible();
    // Only the friend can confirm: the helper never gets that button.
    await expect(screen.getByRole('button', 'Confirm I am safe')).toBeHidden();

    // The friend confirms from their own phone, played through the API.
    await call(friend, `/requests/${requestId}/confirm-complete`, 'POST', {});
    await expect(screen.getByText('Nina confirmed they are safe')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Assistance is complete. Location is no longer shared.')).toBeVisible();
    requestId = undefined;
  } finally {
    if (requestId) await call(friend, `/requests/${requestId}/interrupt`, 'POST', {}).catch(() => {});
    const contacts: { id: string }[] = await call(friend, '/contacts').catch(() => []);
    for (const contact of contacts) await call(friend, `/contacts/${contact.id}`, 'DELETE').catch(() => {});
  }
});
