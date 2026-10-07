import { parseFeltIntensity, parseQuakeRegion } from './region';
import { relativeTime } from './time';
import type { HazardItem } from './api';

type Translate = (key: string, values?: Record<string, unknown>) => string;
const SPOKEN_TIME = { timeJustNow: 'timeJustNow', timeMinutes: 'a11yMinutes', timeHours: 'a11yHours', timeDays: 'a11yDays' } as const;

const coordinate = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;

// One reading of a feed item, shared by the card and the detail page so the two can never disagree.
export function hazardFacts(item: HazardItem, t: Translate, language: string, now = Date.now()) {
  const time = relativeTime(item.occurredAt, now);
  const ago = t(time.key, { count: time.count });
  const typeName = t(`hazard_${item.type}`);
  const quake = item.type === 'earthquake' && item.magnitude != null;
  const occurred = new Date(item.occurredAt);
  const when = Number.isNaN(occurred.getTime()) ? ago : occurred.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  const spokenTime = t(SPOKEN_TIME[time.key], { count: time.count });
  if (!quake) {
    const count = item.reportCount ?? 0;
    const caption = t('reportsCaption', { count });
    const latest = t('latestReport', { time: ago });
    return {
      quake, typeName, figure: String(count), caption, title: t(`reports_${item.type}`), lines: [latest],
      footer: `${item.source} · ${t('unverified')}`,
      label: [`${typeName}, ${count} ${caption}`, t('latestReport', { time: spokenTime }), t('a11ySource', { source: item.source }), t('unverified')].join('. '),
      facts: [
        { label: t('factReports'), value: String(count) },
        { label: t('factLatest'), value: when },
        { label: t('factSource'), value: item.source },
      ],
    };
  }
  const magnitude = item.magnitude!.toFixed(1);
  const region = parseQuakeRegion(item.region);
  const felt = parseFeltIntensity(item.felt);
  const place = region ? t('quakePlace', { distance: region.distanceKm, direction: t(`dir_${region.direction}`), place: region.place }) : null;
  const setting = region?.setting ? t(region.setting === 'sea' ? 'quakeSea' : 'quakeLand') : null;
  const depth = item.depthKm != null ? t('quakeDepth', { km: Math.round(item.depthKm) }) : null;
  // The card says where the shaking was noticed in plain words; the intensity numeral (MMI) is detail-page material.
  const feltLine = felt?.place ? t('shakingFelt', { place: felt.place }) : null;
  // An unparsed BMKG region is shown as written, under a title that still says what happened.
  const where = place ? region!.area : item.region;
  const physical = [depth, setting].filter(Boolean).join(' · ');
  const lines = [where, physical, feltLine].filter((line): line is string => Boolean(line));
  return {
    quake, typeName, figure: magnitude, caption: t('magnitudeCaption'), title: place ?? t('quakeTitle', { magnitude }), lines,
    footer: t('timeAndSource', { time: ago, source: item.source }),
    label: [t('a11yQuakeTitle', { magnitude }), place, where, physical, feltLine, spokenTime, t('a11ySource', { source: item.source })].filter(Boolean).join('. '),
    facts: [
      { label: t('factMagnitude'), value: magnitude },
      depth && { label: t('factDepth'), value: `${Math.round(item.depthKm!)} km` },
      { label: t('factEpicentre'), value: [place ?? item.region, place && region!.area].filter(Boolean).join(', ') },
      setting && { label: t('factSetting'), value: setting },
      item.latitude != null && item.longitude != null && { label: t('factCoordinates'), value: `${coordinate(item.latitude, t('coordNorth'), t('coordSouth'))}, ${coordinate(item.longitude, t('coordEast'), t('coordWest'))}` },
      item.felt && { label: t('factShaking'), value: felt?.place ? `${felt.place} · ${t('mmiLevel', { level: felt.text })}` : item.felt },
      { label: t('factTime'), value: when },
      { label: t('factSource'), value: item.source },
    ].filter((fact): fact is { label: string; value: string } => Boolean(fact && fact.value)),
  };
}
