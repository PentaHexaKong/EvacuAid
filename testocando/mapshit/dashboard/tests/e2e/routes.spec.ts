import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import regions from './fixtures/regions.json' with { type: 'json' }
import details from './fixtures/region-details.json' with { type: 'json' }
import assistance from './fixtures/assistance.json' with { type: 'json' }
import routes from './fixtures/operational-routes.json' with { type: 'json' }
import houses from './fixtures/safe-houses.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.route('**/command-center/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.EVACUAID_MAP = { mapboxStyle: "mapbox/standard" };' }))
  await page.route('**/api/command/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/command/', '')
    const fixtures: Record<string, unknown> = { regions, 'safe-houses': houses, 'operations/assistance': assistance, 'operations/routes': routes }
    return route.fulfill({ json: path.startsWith('regions/') ? details[path.slice(8) as keyof typeof details] : fixtures[path] ?? [] })
  })
})

test('recalculates a draft with the exact POST body and keyboard coordinates', async ({ page }) => {
  let body: unknown
  await page.route('**/api/command/operations/routes', route => { expect(route.request().method()).toBe('POST'); body = route.request().postDataJSON(); return route.fulfill({ json: routes[0] }) })
  await page.goto('./#/operations/routes')
  await page.getByRole('button', { name: 'Edit / recalculate' }).click()
  await expect(page.getByText('REGION ALPHA', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Route name', exact: true }).fill('Updated route')
  await page.getByRole('spinbutton', { name: 'Assembly-point latitude' }).fill('-6.25')
  await page.getByRole('spinbutton', { name: 'Assembly-point longitude' }).fill('106.85')
  await page.getByText('Require step-free routing (unknown accessibility remains unknown)', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pick assembly point on map' })).toBeDisabled()
  await page.getByRole('button', { name: 'Calculate and save draft' }).click()
  await expect(page.locator('#route-feedback')).toHaveText('Draft saved · Ready · No known hazard. Publish re-evaluates current evidence.')
  expect(body).toEqual({ id: 'route-1', name: 'Updated route', regionId: 'region-a', shelterId: 'shelter-a', originLatitude: -6.25, originLongitude: 106.85, mobilityRequired: true })
})

test('evaluated geometry shows overview for one second without operations requests', async ({ page }) => {
  const casesLoaded = page.waitForResponse(response => response.url().includes('/operations/assistance?'))
  await page.goto('./#/operations/routes')
  await casesLoaded
  await expect(page.getByRole('button', { name: 'Show evaluated geometry' })).toBeVisible()
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/command/operations')) requests.push(request.url()) })
  await page.getByRole('button', { name: 'Show evaluated geometry' }).click()
  await expect(page).toHaveURL(/#\/overview$/)
  await expect(page.locator('#selected-name')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(requests).toEqual([])
})

test('empty routes uses the legacy Empty', async ({ page }) => {
  await page.route('**/operations/routes?**', route => route.fulfill({ json: [] }))
  await page.goto('./#/operations/routes')
  await expect(page.locator('[data-slot="empty"]')).toHaveText('No routes yet. Select a region on the overview map, then calculate a draft below.')
})

test('503 routes uses the exact connection Alert', async ({ page }) => {
  await page.route('**/operations/routes?**', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('./#/operations/routes')
  await expect(page.getByRole('alert')).toHaveText('Connection unavailable · retained data may be stale. EvacuAid backend is unavailable. Start the backend to load regional data.')
})

for (const [action, path, message] of [['Revalidate and publish', 'publish', 'Route published.'], ['Withdraw', 'withdraw', 'Route withdrawn.']]) {
  test(action + ' uses the exact bodyless POST', async ({ page }) => {
    let called = false
    await page.route('**/operations/routes/route-1/' + path, route => { called = true; expect(route.request().method()).toBe('POST'); expect(route.request().postData()).toBeNull(); return route.fulfill({ json: routes[0] }) })
    await page.goto('./#/operations/routes')
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.locator('#operations-message')).toHaveText(message)
    expect(called).toBe(true)
  })
}

test('selected overview region supplies shelters and New route retains the region', async ({ page }) => {
  await page.goto('./#/overview')
  await expect(page.locator('#selected-name')).toBeVisible()
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await page.getByRole('link', { name: 'Route setter', exact: true }).click()
  await expect(page.getByText('REGION ALPHA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Recorded shelter' }).click()
  await page.getByRole('option', { name: 'Reference shelter · reference capacity 100 · step-free unknown' }).click()
  await page.getByRole('textbox', { name: 'Route name', exact: true }).fill('A route')
  await page.getByRole('button', { name: 'New route', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Route name', exact: true })).toHaveValue('')
  await expect(page.getByText('REGION ALPHA', { exact: true })).toBeVisible()
})

test('mock mode prevents operational calculation and publishing', async ({ page }) => {
  await page.goto('./#/overview')
  await expect(page.locator('#selected-name')).toBeVisible()
  await page.getByRole('switch', { name: 'Mock mode' }).focus()
  await page.getByRole('switch', { name: 'Mock mode' }).press('Space')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await page.getByRole('link', { name: 'Route setter', exact: true }).click()
  let calls = 0
  page.on('request', request => { if (request.method() === 'POST') calls++ })
  await page.getByRole('button', { name: 'Revalidate and publish' }).click()
  await expect(page.locator('#operations-message')).toHaveText('Could not save: Disable mock mode before publishing operational routes')
  await page.getByRole('button', { name: 'Edit / recalculate' }).click()
  await expect(page.getByText('REGION ALPHA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Calculate and save draft' }).click()
  await expect(page.locator('#route-feedback')).toHaveText('Disable mock mode before calculating operational routes')
  expect(calls).toBe(0)
})

for (const width of [1440, 390]) {
  test('routes remains contained and accessible at ' + String(width), async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/operations/routes')
    await expect(page.getByRole('heading', { name: 'Route setter', exact: true })).toBeVisible()
    await expect(page.getByText('Assembly route', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await page.screenshot({ path: 'output/playwright/routes-' + String(width) + '.png', fullPage: true })
  })
}

test('show evaluated geometry never refetches operations after their mount cache expires', async ({ page }) => {
  await page.clock.install()
  await page.goto('./#/operations/routes')
  await expect(page.getByRole('button', { name: 'Show evaluated geometry' })).toBeVisible()
  await page.clock.fastForward(31000)
  await expect(page.locator('#operations-message')).toHaveText(/Connected/)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/command/operations')) requests.push(request.url()) })
  await page.getByRole('button', { name: 'Show evaluated geometry' }).click()
  await expect(page.locator('#selected-name')).toBeVisible()
  await page.clock.fastForward(1000)
  expect(requests).toEqual([])
})

test('invalid route fields and a missing shelter never POST', async ({ page }) => {
  let posts = 0
  await page.route('**/api/command/operations/routes', route => { if (route.request().method() === 'POST') posts++; return route.fulfill({ json: route.request().method() === 'POST' ? routes[0] : routes }) })
  await page.goto('./#/operations/routes')
  await page.getByRole('button', { name: 'Edit / recalculate' }).click()
  const submit = page.getByRole('button', { name: 'Calculate and save draft' })
  const name = page.getByRole('textbox', { name: 'Route name', exact: true })
  const latitude = page.getByRole('spinbutton', { name: 'Assembly-point latitude' })
  await name.fill('ab'); await submit.click()
  await latitude.fill('91'); await name.fill('Valid route'); await submit.click()
  await page.getByRole('button', { name: 'New route' }).click()
  await name.fill('Valid route'); await latitude.fill('-6.25')
  await page.getByRole('spinbutton', { name: 'Assembly-point longitude' }).fill('106.85')
  await submit.click()
  await page.waitForTimeout(300)
  expect(posts).toBe(0)
})

test('a cold load into Route setter selects the first region like the legacy boot', async ({ page }) => {
  await page.goto('./#/operations/routes')
  await expect(page.locator('#route-form strong')).toHaveText('REGION ALPHA')
})
