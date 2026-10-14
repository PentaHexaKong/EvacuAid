import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import regions from './fixtures/regions.json' with { type: 'json' }
import details from './fixtures/region-details.json' with { type: 'json' }
import houses from './fixtures/safe-houses.json' with { type: 'json' }
import assistance from './fixtures/assistance.json' with { type: 'json' }
import routes from './fixtures/routes.json' with { type: 'json' }
import reports from './fixtures/reports.json' with { type: 'json' }
import checkins from './fixtures/check-ins.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.route('**/command-center/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.EVACUAID_MAP = { mapboxStyle: "mapbox/standard" };' }))
  await page.route('**/api/command/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/command/', '')
    const fixtures: Record<string, unknown> = { regions, 'safe-houses': houses, 'mock-disasters': [], 'operations/reports': reports, 'operations/check-ins': checkins, 'operations/assistance': assistance, 'operations/routes': routes }
    return route.fulfill({ json: path.startsWith('regions/') ? details[path.slice(8) as keyof typeof details] : fixtures[path] ?? [] })
  })
})

test('check-ins show scope and regional aggregates without writes', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (request.url().includes('/api/command/') && request.method() !== 'GET') writes.push(request.url()) })
  await page.goto('./#/operations/check-ins')
  await expect(page.locator('#ops-checkins-scope')).toHaveText(checkins.scope)
  await expect(page.getByRole('rowheader', { name: 'region-alpha', exact: true })).toBeVisible()
  await expect(page.getByText('Arrived', { exact: true })).toBeVisible()
  await expect(page.getByText('12 people', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh operations' }).click()
  expect(writes).toEqual([])
})

test('empty check-ins use BoardUI Empty and exact copy', async ({ page }) => {
  await page.route('**/api/command/operations/check-ins', route => route.fulfill({ json: { scope: checkins.scope, regions: [] } }))
  await page.goto('./#/operations/check-ins')
  await expect(page.locator('[data-slot="empty"]')).toHaveText('No check-ins in the last 24 hours.')
})

test('503 check-ins use the exact connection Alert', async ({ page }) => {
  await page.route('**/api/command/operations/check-ins', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('./#/operations/check-ins')
  await expect(page.getByRole('alert')).toHaveText('Connection unavailable · retained data may be stale. EvacuAid backend is unavailable. Start the backend to load regional data.')
})

for (const width of [1440, 390]) {
  test('check-ins remain contained at ' + String(width), async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/operations/check-ins')
    await expect(page.locator('#ops-checkins-scope')).toHaveText(checkins.scope)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await page.screenshot({ path: 'output/playwright/check-ins-' + String(width) + '.png', fullPage: true })
  })
}
