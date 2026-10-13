import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import regions from './fixtures/regions.json' with { type: 'json' }
import details from './fixtures/region-details.json' with { type: 'json' }
import assistance from './fixtures/assistance.json' with { type: 'json' }
import routes from './fixtures/routes.json' with { type: 'json' }
import houses from './fixtures/safe-houses.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.route('**/command-center/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.EVACUAID_MAP = { mapboxStyle: "mapbox/standard" };' }))
  await page.route('**/api/command/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/command/', '')
    const fixtures: Record<string, unknown> = { regions, 'safe-houses': houses, 'operations/assistance': assistance, 'operations/routes': routes }
    return route.fulfill({ json: path.startsWith('regions/') ? details[path.slice(8) as keyof typeof details] : fixtures[path] ?? [] })
  })
})

test('acknowledges a case with exact PATCH body, counter and whitespace validation', async ({ page }) => {
  let body: unknown
  await page.route('**/operations/assistance/case-1', route => { expect(route.request().method()).toBe('PATCH'); body = route.request().postDataJSON(); return route.fulfill({ json: {} }) })
  await page.goto('./#/operations/assistance')
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Acknowledge case case-1', { exact: true })).toBeVisible()
  await dialog.getByRole('textbox', { name: /Note/ }).fill('   ')
  await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a note of 3–500 characters.')
  expect(body).toBeUndefined()
  await dialog.getByRole('textbox', { name: /Note/ }).fill('  Assigned team  ')
  await expect(dialog.getByText('17/500')).toBeVisible()
  await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.locator('#operations-message')).toHaveText('Case case-1 acknowledged.')
  expect(body).toEqual({ status: 'ACKNOWLEDGED', note: 'Assigned team', expectedUpdatedAt: null, assignedRouteId: null })
})

test('empty assistance uses the legacy Empty', async ({ page }) => {
  await page.route('**/operations/assistance?**', route => route.fulfill({ json: [] }))
  await page.goto('./#/operations/assistance')
  await expect(page.locator('[data-slot="empty"]')).toHaveText('No open assistance requests.')
})

test('503 assistance uses the exact connection Alert', async ({ page }) => {
  await page.route('**/operations/assistance?**', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('./#/operations/assistance')
  await expect(page.getByRole('alert')).toHaveText('Connection unavailable · retained data may be stale. EvacuAid backend is unavailable. Start the backend to load regional data.')
})

test('dispatch assigns only usable published routes with the legacy PATCH body', async ({ page }) => {
  let body: unknown
  await page.route('**/operations/routes?**', route => route.fulfill({ json: [{ id: 'usable', name: 'Published route', usable: true }, { id: 'draft', name: 'Draft route', usable: false }] }))
  await page.route('**/operations/assistance/case-1', route => { body = route.request().postDataJSON(); return route.fulfill({ json: {} }) })
  await page.goto('./#/operations/assistance')
  await page.getByText('More actions', { exact: true }).nth(1).click()
  await page.getByRole('button', { name: 'Assign route and dispatch' }).click()
  await expect(page.locator('#operations-message')).toHaveText('Could not save: Choose a current published route')
  await page.getByRole('button', { name: 'Assign published route to case case-1' }).click()
  await expect(page.getByRole('option', { name: 'Draft route' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Published route', exact: true }).click()
  await page.getByRole('button', { name: 'Assign route and dispatch' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Note/ }).fill('Team dispatched')
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()
  await expect(page.locator('#operations-message')).toHaveText('Case case-1 dispatched.')
  expect(body).toEqual({ status: 'DISPATCHED', note: 'Team dispatched', expectedUpdatedAt: null, assignedRouteId: 'usable' })
})

test('stale assistance retains its disclosure and exact empty copy', async ({ page }) => {
  await page.route('**/operations/assistance?**', route => route.fulfill({ json: assistance.filter(item => item.stale) }))
  await page.goto('./#/operations/assistance')
  await expect(page.locator('[data-slot="empty"]')).toHaveText('No assistance requests in the last 24 hours.')
  await page.getByText('Older than 24 hours (1)', { exact: true }).click()
  await expect(page.getByText('Case case-2', { exact: true })).toBeVisible()
  await expect(page.getByText('Needs assistance · Stale', { exact: true })).toBeVisible()
})

for (const width of [1440, 390]) {
  test('assistance remains contained and accessible at ' + String(width), async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/operations/assistance')
    await expect(page.getByRole('heading', { name: 'Assistance', exact: true })).toBeVisible()
    await expect(page.getByText('Case case-1', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await page.screenshot({ path: 'output/playwright/assistance-' + String(width) + '.png', fullPage: true })
  })
}
