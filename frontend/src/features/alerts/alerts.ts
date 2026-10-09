import type { TFunction } from 'i18next';
import type { AlertItem } from './api';

export const LEVEL_ORDER = { waspada: 1, siaga: 2, awas: 3 } as const;
export const levelLabels = { normal: 'levelNormal', waspada: 'levelWaspada', siaga: 'levelSiaga', awas: 'levelAwas' } as const;
export const compareAlerts = (a: AlertItem, b: AlertItem) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || (b.issuedAt ? Date.parse(b.issuedAt) : -Infinity) - (a.issuedAt ? Date.parse(a.issuedAt) : -Infinity) || 0;
export const topAlert = (items: AlertItem[]) => [...items].sort(compareAlerts)[0];
const titles: Record<string, string> = { FLOOD: 'alertHazardFlood', EARTHQUAKE: 'alertHazardEarthquake', TSUNAMI: 'alertHazardTsunami', WILDFIRE: 'alertHazardWildfire', LANDSLIDE: 'alertHazardLandslide', EXTREME_WEATHER: 'alertHazardWeather' };
export type AlertViewModel = { id: string; level: AlertItem['level']; title: string; area: string; issued: string | null; window: string | null; body: string; steps: string[]; coordinate: { latitude: number; longitude: number } };
export function formatAlertTime(iso: string) {
  const date = new Date(Date.parse(iso) + 7 * 60 * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} WIB`;
}
export function mapAlert(item: AlertItem, t: TFunction): AlertViewModel {
  const title = titles[item.hazardType] ?? 'alertHazardOther';
  const area = item.area ?? t('alertAreaYours');
  const stepLevel = item.level.charAt(0).toUpperCase() + item.level.slice(1);
  return { id: item.id, level: item.level, title, area, issued: item.issuedAt ? formatAlertTime(item.issuedAt) : null, window: item.validUntil ? t('alertUntil', { time: formatAlertTime(item.validUntil) }) : null, body: t('alertBody', { source: item.source, level: t(levelLabels[item.level]), hazard: t(title), area }), steps: [1, 2, 3].map(index => `alertStep${stepLevel}${index}`), coordinate: { latitude: item.latitude, longitude: item.longitude } };
}
