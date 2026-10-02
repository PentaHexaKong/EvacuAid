import { brand, colors, sky } from './tokens.json';
function luminance(hex: string) {
  const values = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('normal text meets 4.5:1 on intended surfaces including every gradient sample', () => {
  for (const color of [colors.ink, colors.muted, colors.primary, colors.critical, colors.caution]) {
    expect(contrast(color, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, colors.canvas)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(colors.ink, colors.sky)).toBeGreaterThanOrEqual(4.5);
  for (let step = 0; step <= 100; step += 1) {
    const a = colors.gradientTop.slice(1).match(/../g)!.map((v) => parseInt(v, 16));
    const b = colors.primary.slice(1).match(/../g)!.map((v) => parseInt(v, 16));
    const hex = '#' + a.map((v, i) => Math.round(v + (b[i] - v) * step / 100).toString(16).padStart(2, '0')).join('');
    expect(contrast(colors.surface, hex)).toBeGreaterThanOrEqual(4.5);
  }
});

test('status text meets 4.5:1 across every step of each alert-level sky', () => {
  const mix = (from: string, to: string, step: number) => '#' + [1, 3, 5].map(index => Math.round(parseInt(from.slice(index, index + 2), 16) + (parseInt(to.slice(index, index + 2), 16) - parseInt(from.slice(index, index + 2), 16)) * step / 20).toString(16).padStart(2, '0')).join('');
  for (const { stops, ink } of Object.values(sky)) {
    const sequence = [...stops, colors.canvas];
    for (let index = 0; index < stops.length; index += 1) {
      for (let step = 0; step <= 20; step += 1) expect(contrast(ink, mix(sequence[index], sequence[index + 1], step))).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('quiet settings labels stay readable on canvas and white', () => {
  expect(contrast(colors.quiet, colors.canvas)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.quiet, colors.surface)).toBeGreaterThanOrEqual(4.5);
});

test('soft fills from the design system keep their text readable', () => {
  expect(contrast(colors.muted, colors.chip)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.caution, colors.cautionSoft)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.primary, colors.accentSoft)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.ink, colors.selected)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.primary, colors.selected)).toBeGreaterThanOrEqual(4.5);
});

test('white welcome text meets 4.5:1 across the lower half of the brand gradient', () => {
  const [, from, to] = brand.stops;
  for (let step = 0; step <= 20; step += 1) {
    const hex = '#' + [1, 3, 5].map(index => Math.round(parseInt(from.slice(index, index + 2), 16) + (parseInt(to.slice(index, index + 2), 16) - parseInt(from.slice(index, index + 2), 16)) * step / 20).toString(16).padStart(2, '0')).join('');
    expect(contrast(colors.surface, hex)).toBeGreaterThanOrEqual(4.5);
  }
});

test('faded headline words (ink at 75% over the sky) meet 3:1 large-text contrast on every level', () => {
  const fade = (ink: string, bg: string) => '#' + [1, 3, 5].map(i => Math.round(parseInt(ink.slice(i, i + 2), 16) * 0.75 + parseInt(bg.slice(i, i + 2), 16) * 0.25).toString(16).padStart(2, '0')).join('');
  for (const { stops, ink } of Object.values(sky)) {
    for (const bg of [stops[0], stops[1]]) expect(contrast(fade(ink, bg), bg)).toBeGreaterThanOrEqual(3);
  }
});

test('recent alert card text stays readable on every level tint', () => {
  for (const { stops } of Object.values(sky)) {
    expect(contrast(colors.ink, stops[2])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, stops[2])).toBeGreaterThanOrEqual(4.5);
  }
});
