import type { TFunction } from 'i18next';
import type { AlertItem } from './api';

export const LEVEL_ORDER = { waspada: 1, siaga: 2, awas: 3 } as const;
export const levelLabels = { normal: 'levelNormal', waspada: 'levelWaspada', siaga: 'levelSiaga', awas: 'levelAwas' } as const;
export const compareAlerts = (a: AlertItem, b: AlertItem) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || (b.issuedAt ? Date.parse(b.issuedAt) : -Infinity) - (a.issuedAt ? Date.parse(a.issuedAt) : -Infinity) || 0;
export const topAlert = (items: AlertItem[]) => [...items].sort(compareAlerts)[0];
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const titles: Record<string, string> = { FLOOD: 'alertHazardFlood', EARTHQUAKE: 'alertHazardEarthquake', TSUNAMI: 'alertHazardTsunami', WILDFIRE: 'alertHazardWildfire', LANDSLIDE: 'alertHazardLandslide', EXTREME_WEATHER: 'alertHazardWeather' };
export type AlertViewModel = { id: string; level: AlertItem['level']; title: string; area: string; issued: string | null; window: string | null; body: string; steps: string[]; coordinate: { latitude: number; longitude: number } };
function formatAlertTimestamp(iso: string) {
  const date = new Date(Date.parse(iso) + 7 * 60 * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} WIB`;
}
export function formatAlertTime(iso: string, now = Date.now()) {
  const date = new Date(Date.parse(iso) + 7 * 60 * 60_000);
  const today = new Date(now + 7 * 60 * 60_000);
  if (date.getUTCFullYear() === today.getUTCFullYear() && date.getUTCMonth() === today.getUTCMonth() && date.getUTCDate() === today.getUTCDate()) return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} WIB`;
  return formatAlertTimestamp(iso);
}
export function mapAlert(item: AlertItem, t: TFunction, now = Date.now()): AlertViewModel {
  const title = titles[item.hazardType] ?? 'alertHazardOther';
  const area = item.area ?? t('alertAreaYours');
  const stepLevel = item.level.charAt(0).toUpperCase() + item.level.slice(1);
  return { id: item.id, level: item.level, title, area, issued: item.issuedAt ? formatAlertTimestamp(item.issuedAt) : null, window: item.validUntil ? t('alertUntil', { time: formatAlertTime(item.validUntil, now) }) : null, body: t('alertBody', { level: t(levelLabels[item.level]), hazard: lowerFirst(t(title)), area: item.area ?? t('alertAreaYoursInline') }), steps: [1, 2, 3].map(index => `alertStep${stepLevel}${index}`), coordinate: { latitude: item.latitude, longitude: item.longitude } };
}

export function alertsSpokenSummary(items: AlertItem[], t: TFunction): string {
  if (!items.length) return t('alertsEmpty');
  return [t('alertsSpokenCount', { count: items.length }), ...[...items].sort(compareAlerts).map(item => {
    const alert = mapAlert(item, t);
    const time = alert.window?.match(/\d{2}:\d{2}/)?.[0];
    return t('alertsSpokenItem', { level: t(levelLabels[alert.level]), hazard: t(alert.title), area: alert.area, until: time ? `, ${t('alertUntil', { time }).toLocaleLowerCase()}` : '' });
  })].join(' ');
}
