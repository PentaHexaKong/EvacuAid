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

test('confirms a report with the legacy review body and live note counter', async ({ page }) => {
  let body: unknown
  await page.route('**/api/command/operations/reports/report-1', route => { body = route.request().postDataJSON() as unknown; expect(route.request().method()).toBe('PATCH'); return route.fulfill({ json: reports[0] }) })
  await page.goto('./#/operations/reports')
  await expect(page.getByText('Road blocked by debris', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Note/ }).fill('  Verified debris  ')
  await expect(dialog.getByText('19/500', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm report', exact: true }).click()
  await expect(page.locator('#operations-message')).toHaveText('Report confirmed.')
  expect(body).toEqual({ status: 'CONFIRMED', note: 'Verified debris', expectedUpdatedAt: reports[0].updatedAt, barrier: false, radiusM: 30, validUntil: null })
})

test('show on map retains the overview for one second without operations requests', async ({ page }) => {
  const routesLoaded = page.waitForResponse(response => response.url().includes('/operations/routes?'))
  const casesLoaded = page.waitForResponse(response => response.url().includes('/operations/assistance?'))
  await page.goto('./#/operations/reports')
  await Promise.all([routesLoaded, casesLoaded])
  await expect(page.getByRole('button', { name: 'Show on map', exact: true })).toBeVisible()
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/command/operations')) requests.push(request.url()) })
  await page.getByRole('button', { name: 'Show on map', exact: true }).click()
  await expect(page).toHaveURL(/#\/overview$/)
  await expect(page.locator('#selected-name')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(requests).toEqual([])
})

test('empty reports use BoardUI Empty and exact copy', async ({ page }) => {
  await page.route('**/api/command/operations/reports?**', route => route.fulfill({ json: [] }))
  await page.goto('./#/operations/reports')
  await expect(page.locator('[data-slot="empty"]')).toHaveText('No field reports to review. New public reports appear here within 15 seconds.')
})

test('503 reports use the exact connection Alert', async ({ page }) => {
  await page.route('**/api/command/operations/reports?**', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('./#/operations/reports')
  await expect(page.getByRole('alert')).toHaveText('Connection unavailable · retained data may be stale. EvacuAid backend is unavailable. Start the backend to load regional data.')
})

test('barrier confirmation retains radius and expiry, rejects whitespace-only notes', async ({ page }) => {
  let body: Record<string, unknown> | undefined
  await page.route('**/api/command/operations/reports/report-1', route => { body = route.request().postDataJSON() as Record<string, unknown>; return route.fulfill({ json: reports[0] }) })
  await page.goto('./#/operations/reports')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Note/ }).fill('     ')
  await dialog.getByRole('button', { name: 'Confirm report', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a note of 5–500 characters.')
  expect(body).toBeUndefined()
  await dialog.getByRole('textbox', { name: /Note/ }).fill('Verified obstruction')
  await dialog.getByText('Responders verified this is a hard evacuation barrier (published routes will be invalidated)', { exact: true }).click()
  await dialog.getByRole('spinbutton', { name: 'Barrier radius (m)' }).fill('120')
  await dialog.getByRole('spinbutton', { name: 'Valid for (hours)' }).fill('3')
  const before = Date.now()
  await dialog.getByRole('button', { name: 'Confirm report', exact: true }).click()
  await expect(page.locator('#operations-message')).toHaveText('Report confirmed.')
  expect(body).toMatchObject({ barrier: true, radiusM: 120, note: 'Verified obstruction' })
  expect(new Date(String(body?.validUntil)).getTime()).toBeGreaterThanOrEqual(before + 3 * 3600000)
  expect(new Date(String(body?.validUntil)).getTime()).toBeLessThanOrEqual(Date.now() + 3 * 3600000)
})

for (const [action, submit, status, message] of [['Reject', 'Reject report', 'REJECTED', 'Report rejected.'], ['Mark resolved', 'Mark resolved', 'RESOLVED', 'Report resolved.']]) {
  test(action + ' submits the exact review body', async ({ page }) => {
    let body: unknown
    await page.route('**/api/command/operations/reports/report-1', route => { body = route.request().postDataJSON() as unknown; return route.fulfill({ json: reports[0] }) })
    await page.goto('./#/operations/reports')
    await page.getByText('More actions', { exact: true }).last().click()
    await page.getByRole('button', { name: action, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    await dialog.getByRole('textbox', { name: /Note/ }).fill('Reviewed evidence')
    await dialog.getByRole('button', { name: submit, exact: true }).click()
    await expect(page.locator('#operations-message')).toHaveText(message)
    expect(body).toEqual({ status, note: 'Reviewed evidence', expectedUpdatedAt: reports[0].updatedAt, barrier: false, radiusM: 30, validUntil: null })
  })
}

test('reports page in batches of fifty', async ({ page }) => {
  await page.route('**/api/command/operations/reports?**', route => {
    const offset = new URL(route.request().url()).searchParams.get('offset')
    return route.fulfill({ json: offset === '0' ? Array.from({ length: 50 }, (_, i) => ({ ...reports[0], id: 'report-' + String(i), description: 'Report ' + String(i) })) : [] })
  })
  await page.goto('./#/operations/reports')
  await expect(page.getByRole('button', { name: 'Previous reports' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(50)
  const next = page.waitForRequest(request => request.url().includes('operations/reports?limit=50&offset=50'))
  await page.getByRole('button', { name: 'Next reports' }).click()
  await next
  await expect(page.getByRole('button', { name: 'Next reports' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous reports' })).toBeEnabled()
})

for (const width of [1440, 390]) {
  test('reports remain contained at ' + String(width), async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/operations/reports')
    await expect(page.getByText('Road blocked by debris', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await page.screenshot({ path: 'output/playwright/reports-' + String(width) + '.png', fullPage: true })
  })
}

test('the next operational poll replaces a review confirmation with connection status', async ({ page }) => {
  await page.clock.install()
  await page.route('**/api/command/operations/reports/report-1', route => route.fulfill({ json: reports[0] }))
  await page.goto('./#/operations/reports')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('textbox', { name: /Note/ }).fill('Reviewed evidence')
  await page.getByRole('button', { name: 'Confirm report', exact: true }).click()
  await expect(page.locator('#operations-message')).toHaveText('Report confirmed.')
  const polled = page.waitForResponse(response => response.url().includes('/operations/reports?'))
  await page.clock.fastForward(15001)
  await polled
  await expect(page.locator('#operations-message')).toHaveText(/Connected · last received/)
})
