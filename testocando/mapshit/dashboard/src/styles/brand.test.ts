import { readFileSync } from 'node:fs'
import { URL as FileURL } from 'node:url'
import { expect, test } from 'vitest'

const css = readFileSync(new FileURL('./theme.css', import.meta.url), 'utf8')
const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const [r = 0, g = 0, b = 0] = c
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
test('BoardUI accent is the EvacuAid app-icon blue', () => {
  expect(css).toMatch(/--color-primary-base:\s*#2E54E6/i)
})
test('white text on the brand action colour meets AA', () => {
  expect((1.05) / (lum('#2E54E6') + 0.05)).toBeGreaterThanOrEqual(4.5)
})
