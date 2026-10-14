import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('**/command-center/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.EVACUAID_MAP = {"mapboxStyle":"mapbox/standard"}' }))
  await page.route('**/api/command/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
})

test('mobile drawer contains focus and Escape restores the menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/overview')
  const menu = page.getByRole('button', { name: 'Open navigation' })
  await menu.click()
  const drawer = page.getByRole('dialog', { name: 'EvacuAid' })
  await expect(drawer).toBeVisible()
  await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(menu).toBeFocused()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
})

test('mobile backdrop closes the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/overview')
  const menu = page.getByRole('button', { name: 'Open navigation' })
  await menu.click()
  await expect(page.getByRole('dialog', { name: 'EvacuAid' })).toBeVisible()
  await page.mouse.click(360, 400)
  await expect(page.getByRole('dialog', { name: 'EvacuAid' })).toBeHidden()
  await expect(menu).toBeFocused()
})

test('hash navigation preserves the shell and data environment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./#/overview')
  const environment = page.getByRole('group', { name: 'Data environment' })
  await environment.getByRole('button', { name: 'Simulation' }).click()
  await page.getByRole('link', { name: 'Field reports' }).click()
  await expect(page).toHaveURL(/#\/operations\/reports$/)
  await expect(page).toHaveTitle('Field reports · EvacuAid Command Center')
  await expect(environment.getByRole('button', { name: 'Simulation' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#map-host-boundary')).toContainText('Field reports')
  await page.getByRole('link', { name: 'About this data' }).click()
  await expect(page).toHaveTitle('About this data · EvacuAid Command Center')
  await page.reload()
  await expect(environment.getByRole('button', { name: 'Operational' })).toHaveAttribute('aria-pressed', 'true')
})

for (const width of [1440, 390]) {
  test(`overview has no serious accessibility violations at ${String(width)}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('./#/overview')
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width)
    await page.screenshot({ path: testInfo.outputPath(`shell-${String(width)}.png`), fullPage: true })
  })
}

test('legacy hashes, redirects and unknown hashes resolve to the expected views', async ({ page }) => {
  await page.goto('./#operations/assistance')
  await expect(page.getByRole('heading', { name: 'Assistance', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/operations\/assistance$/)
  await page.goto('./#/operations')
  await expect(page.getByRole('heading', { name: 'Field reports', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/operations\/reports$/)
  await page.goto('./#/nope')
  await expect(page.getByRole('heading', { name: 'Regional overview', exact: true })).toBeAttached()
  await expect(page).toHaveURL(/#\/overview$/)
  const brand = page.getByRole('link', { name: 'EvacuAid command center', exact: true })
  await expect(brand).toHaveAttribute('href', '#/overview')
  await expect(brand.locator('span', { hasText: /^E$/ })).toHaveAttribute('aria-hidden', 'true')
})

for (const width of [1440, 390]) {
  test(`shell avoids React Aria focusability warnings at ${String(width)}px`, async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (message) => {
      if (/^<(Focusable|Pressable)> child must/.test(message.text())) warnings.push(message.text())
    })
    await page.setViewportSize({ width, height: 844 })
    await page.goto('./#/overview')
    await expect(page.getByRole(width === 390 ? 'button' : 'group', { name: width === 390 ? 'Open navigation' : 'Data environment' })).toBeVisible()
    if (width === 390) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await expect(page.getByRole('dialog', { name: 'EvacuAid' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'EvacuAid' })).toBeHidden()
    }
    expect(warnings).toEqual([])
  })
}

test('floating sidebar replaces the header and keeps its collapsed rail across reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./#/overview')
  await expect(page.getByRole('banner')).toHaveCount(0)
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
  await expect(sidebar).toHaveCSS('border-radius', '24px')
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left)).toBe(12)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(60)
  await page.reload()
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(60)
  await page.keyboard.press('ControlOrMeta+l')
  await page.getByRole('searchbox', { name: 'Filter navigation' }).fill('route')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/operations\/routes$/)
})
