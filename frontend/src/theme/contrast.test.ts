import { colors } from './tokens.json';
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
