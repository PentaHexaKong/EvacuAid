import type { TFunction } from 'i18next';
import { alertItems } from './test-fixtures';
import { alertsSpokenSummary, formatAlertTime, mapAlert, topAlert } from './alerts';
import en from '@/localization/en.json';

const t = ((key: string, params?: Record<string, string>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), en[key as keyof typeof en] ?? key)) as TFunction;

test('awas beats siaga beats waspada independent of order', () => {
  const items = (['waspada', 'siaga', 'awas'] as const).map((level, index) => ({ ...alertItems[0], id: String(index), level }));
  expect(topAlert(items)?.level).toBe('awas');
  expect(topAlert(items.slice(0, 2))?.level).toBe('siaga');
  expect(topAlert(items.slice(0, 1))?.level).toBe('waspada');
});
test('ties choose newest issued time with null last; empty has no top alert', () => {
  const older = { ...alertItems[0], id: 'older', issuedAt: '2026-09-16T00:00:00Z' };
  const undated = { ...alertItems[0], id: 'undated', issuedAt: null };
  expect(topAlert([undated, older, alertItems[0]])?.id).toBe('rain');
  expect(topAlert([undated, older])?.id).toBe('older');
  expect(topAlert([])).toBeUndefined();
});
test('mapper falls back for unknown hazard, null area and null times', () => {
  const view = mapAlert({ ...alertItems[0], hazardType: 'UNKNOWN', area: null, issuedAt: null, validUntil: null }, t);
  expect(view).toMatchObject({ title: 'alertHazardOther', area: 'Your area', issued: null, window: null });
  expect(view.body).toBe('Official warning for hazard in your area. Level: Alert.');
  expect(view.steps).toEqual(['alertStepSiaga1', 'alertStepSiaga2', 'alertStepSiaga3']);
  expect(view.simulation).toBe(false);
  const simulation = mapAlert({ ...alertItems[0], simulation: true }, t);
  expect(simulation.simulation).toBe(true);
  expect(simulation.area.startsWith(en.alertSimulationTag + ' · ')).toBe(true);
  expect(simulation.body.startsWith(en.alertSimulationNotice + ' ')).toBe(true);
});
test('mapper renders source, coordinates, WIB issue and expiry', () => {
  expect(mapAlert(alertItems[0], t, Date.parse('2026-09-16T16:59:00Z'))).toMatchObject({ title: 'alertHazardWeather', issued: '17 Sep 2026 · 08:30 WIB', window: 'Until 17 Sep 2026 · 11:30 WIB', coordinate: { latitude: -6.2665, longitude: 106.809 } });
});

test.each([
  ['2026-09-17T16:59:00Z', '2026-09-17T16:58:00Z', '23:59 WIB'],
  ['2026-09-17T17:01:00Z', '2026-09-17T16:59:00Z', '18 Sep 2026 · 00:01 WIB'],
  ['2026-09-17T17:01:00Z', '2026-09-17T17:00:00Z', '00:01 WIB'],
  ['2026-09-18T16:59:00Z', '2026-09-17T17:00:00Z', '23:59 WIB'],
] as const)('validity %s relative to %s uses the WIB calendar day', (validUntil, now, time) => {
  expect(formatAlertTime(validUntil, Date.parse(now))).toBe(time);
  expect(mapAlert({ ...alertItems[0], validUntil }, t, Date.parse(now)).window).toBe(`Until ${time}`);
});
test('same-day expiry keeps the issue timestamp in full-date form', () => {
  expect(mapAlert(alertItems[0], t, Date.parse('2026-09-17T01:30:00Z'))).toMatchObject({ issued: '17 Sep 2026 · 08:30 WIB', window: 'Until 11:30 WIB' });
});

const spokenT = ((key: string, params?: Record<string, string | number>) => {
  const resolved = key === 'alertsSpokenCount' ? Number(params?.count) === 1 ? 'alertsSpokenCount_one' : 'alertsSpokenCount_other' : key;
  return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), en[resolved as keyof typeof en] ?? resolved);
}) as TFunction;

test('spoken summary handles none and one warning with area and end time', () => {
  expect(alertsSpokenSummary([], spokenT)).toBe(en.alertsEmpty);
  expect(alertsSpokenSummary([alertItems[0]], spokenT)).toBe('1 warning. Alert: Extreme weather in Example area, until 11:30.');
});

test('spoken summary orders severity without mutating items and falls back for missing area or end time', () => {
  const items = [{ ...alertItems[1], area: null }, { ...alertItems[0], level: 'awas' as const, validUntil: null }];
  expect(alertsSpokenSummary(items, spokenT)).toBe('2 warnings. Danger: Extreme weather in Example area. Caution: Flooding in Your area.');
  expect(items[0].id).toBe('water');
});
