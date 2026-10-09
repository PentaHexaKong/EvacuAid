import type { TFunction } from 'i18next';
import { alertItems } from './test-fixtures';
import { mapAlert, topAlert } from './alerts';
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
});
test('mapper renders source, coordinates, WIB issue and expiry', () => {
  expect(mapAlert(alertItems[0], t)).toMatchObject({ title: 'alertHazardWeather', issued: '17 Sep 2026 · 08:30 WIB', window: 'Until 17 Sep 2026 · 11:30 WIB', coordinate: { latitude: -6.2665, longitude: 106.809 } });
});
