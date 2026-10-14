import { expect, test } from '@playwright/test'
import regions from './fixtures/regions.json' with { type: 'json' }
import parents from './fixtures/parents.json' with { type: 'json' }
import details from './fixtures/region-details.json' with { type: 'json' }
import assistance from './fixtures/assistance.json' with { type: 'json' }
import mocksFixture from './fixtures/mock-disasters.json' with { type: 'json' }
import houses from './fixtures/safe-houses.json' with { type: 'json' }
import routes from './fixtures/routes.json' with { type: 'json' }

let posted: Record<string, unknown> | null

test.beforeEach(async ({ page }) => {
  posted = null
  let mocks: Record<string, unknown>[] = [...mocksFixture]
  await page.route('**/command-center/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.EVACUAID_MAP = { mapboxStyle: "mapbox/standard" };' }))
  await page.route('**/api/command/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/command/', '')
    let body: unknown = []
    if (path === 'regions') body = url.searchParams.get('administrativeLevel') === 'VILLAGE' ? regions : parents
    else if (path.startsWith('regions/')) body = details[path.slice(8) as keyof typeof details]
    else if (path === 'operations/assistance') body = assistance
    else if (path === 'operations/routes') body = routes
    else if (path === 'safe-houses') body = houses
    else if (path === 'mock-disasters') {
      if (request.method() === 'POST') { posted = request.postDataJSON() as Record<string, unknown>; mocks = [{ ...posted, expiresAt: '2026-10-14T01:00:00Z', usersInArea: null }]; body = mocks[0] }
      else if (request.method() === 'DELETE') { mocks = []; body = null }
      else body = mocks
    } else if (path.startsWith('mock-disasters/') && request.method() === 'DELETE') { mocks = []; body = null }
    await route.fulfill({ json: body })
  })
  await page.goto('./overview')
})

test('renders fixture KPIs and region panels without a map token', async ({ page }) => {
  await expect(page.getByText('Map unavailable · set MAPBOX_TOKEN')).toBeVisible()
  const kpis = page.getByRole('region', { name: 'Regional key indicators' })
  await expect(kpis.getByText('3,000', { exact: true })).toBeVisible()
  await expect(kpis.getByText('5', { exact: true })).toBeVisible()
  await expect(kpis.getByText('1 older than 24 h need review')).toBeVisible()
  await page.getByRole('option', { name: /Region Beta/ }).click()
  await expect(page.locator('#selected-name')).toHaveText('Region Beta')
  await expect(page.getByText('Reference capacity and accessibility, no live occupancy')).toBeVisible()
  await expect(page.getByText(/Capacity 100 · step-free access unknown/)).toBeVisible()
  await expect(page.getByText('Reported categories may overlap.')).toBeVisible()
  await expect(page.getByText('Administrative boundary', { exact: true })).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Priority regions' })
  await list.focus()
  await list.press('Home')
  await expect(page.locator('#selected-name')).toHaveText('Region Alpha')
  await list.press('ArrowDown')
  await expect(page.locator('#selected-name')).toHaveText('Region Beta')
})

test('adds and clears a mock disaster through the no-map dialog', async ({ page }) => {
  await page.getByText('Mock mode', { exact: true }).click()
  await page.getByRole('button', { name: 'Add mock disaster', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('spinbutton', { name: 'Assembly-point latitude' }).fill('-6.2')
  await dialog.getByRole('spinbutton', { name: 'Assembly-point longitude' }).fill('106.8')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Test flood')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: /Simulation · Test flood/ })).toBeVisible()
  expect(posted).toMatchObject({ name: 'Test flood', latitude: -6.2, longitude: 106.8, hazardType: 'FLOOD', radiusM: 1000, severity: 'ELEVATED' })
  expect(posted).not.toHaveProperty('kind')
  await expect(page.getByText(/Fewer than 5 recently located EvacuAid users/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear mock items' }).click()
  await expect(page.getByRole('button', { name: /Simulation · Test flood/ })).toHaveCount(0)
})

test('filters use the legacy region parameters and layer controls remain available', async ({ page }) => {
  const request = page.waitForRequest(request => { const url = new URL(request.url()); return url.pathname === '/api/command/regions' && url.searchParams.get('signalLevel') === 'WATCH' })
  await page.getByRole('button', { name: /All signals Signal/ }).click()
  await page.getByRole('option', { name: 'Watch', exact: true }).click()
  const url = new URL((await request).url())
  expect(Object.fromEntries(url.searchParams)).toEqual({ administrativeLevel: 'VILLAGE', dataMode: 'REFERENCE', signalLevel: 'WATCH', limit: '200', offset: '0' })
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Baseline susceptibility' })).not.toBeChecked()
  await page.getByText('Baseline susceptibility', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Baseline susceptibility' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Published evacuation routes' })).toBeChecked()
})

test('saved mock safe houses survive and can be removed without a backend write', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('evacuaid-command-mocks-v1', JSON.stringify([{ id: 'saved-house', kind: 'safeHouse', name: 'Saved house', latitude: -6.2, longitude: 106.8 }])) })
  await page.reload()
  await page.getByText('Mock mode', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mock · Saved house · Safe house' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Saved house', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mock · Saved house · Safe house' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('evacuaid-command-mocks-v1'))).toBe('[]')
})

test('safe-house fields retain limits, nullable values, and backend errors', async ({ page }) => {
  let body: unknown
  await page.route('**/api/command/safe-houses', async route => {
    if (route.request().method() === 'POST') { body = route.request().postDataJSON() as unknown; await route.fulfill({ status: 400, json: { detail: 'Unable to save this safe house.' } }) }
    else await route.fulfill({ json: houses })
  })
  await page.getByRole('button', { name: 'Add safe house', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveAttribute('maxlength', '200')
  await expect(dialog.getByRole('textbox', { name: 'Address', exact: true })).toHaveAttribute('maxlength', '500')
  await expect(dialog.getByRole('spinbutton', { name: 'Capacity', exact: true })).toHaveAttribute('max', '1000000')
  await expect(dialog.getByText('Saving a location does not certify hazard safety or evacuation access.')).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Assembly-point latitude' }).fill('-6.2')
  await dialog.getByRole('spinbutton', { name: 'Assembly-point longitude' }).fill('106.8')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('House')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Unable to save this safe house.')
  expect(body).toMatchObject({ name: 'House', latitude: -6.2, longitude: 106.8, address: null, capacity: null, status: 'UNKNOWN', wheelchairAccessible: null, verifiedNow: false })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('empty and unavailable resources use the legacy copy', async ({ page }) => {
  await page.route('**/api/command/regions?**', route => route.fulfill({ json: [] }))
  await page.reload()
  await expect(page.getByText('No imported regions match these filters. Import administrative GeoJSON to begin.')).toBeVisible()
  await expect(page.locator('#selected-name')).toHaveText('Choose a region')
  await page.route('**/api/command/regions?**', route => route.fulfill({ status: 503, json: {} }))
  await page.reload()
  await expect(page.getByText('EvacuAid backend is unavailable. Start the backend to load regional data.').first()).toBeVisible({ timeout: 15000 })
})

test('mobile controls and lower panels remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Mock mode', { exact: true }).click()
  await page.getByRole('button', { name: 'Add mock disaster', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('#selected-name').scrollIntoViewIfNeeded()
  await expect(page.locator('#selected-name')).toHaveText('Region Alpha')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
