export type Direction = 'n' | 's' | 'e' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
export type QuakeRegion = { distanceKm: string; direction: Direction; place: string; area: string | null; setting: 'sea' | 'land' | null };
export type FeltIntensity = { text: string; from: number; to: number | null };

const DIRECTIONS: Record<string, Direction> = { utara: 'n', selatan: 's', timur: 'e', barat: 'w', timurlaut: 'ne', tenggara: 'se', baratdaya: 'sw', baratlaut: 'nw' };
// BMKG writes the region either as a sentence ("Pusat gempa berada di laut 82 km Timur Laut RUTENG-MANGGARAI-NTT")
// or a short form ("34 km TimurLaut RUTENG-MANGGARAI-NTT"), in any case, with spaced or joined compass words.
const REGION = /^(?:pusat gempa berada di (darat|laut)\s+)?([\d.,]+)\s*km\s+(timur\s*laut|barat\s*laut|barat\s*daya|tenggara|utara|selatan|timur|barat)\s+(.+)$/i;
const PREFIXES: Record<string, string> = { KAB: 'Kab.', KOTA: 'Kota', KEP: 'Kep.' };

// Upper-case BMKG names become title case; short codes (NTT, DKI) and already-mixed names stay as written.
function tidy(part: string) {
  const text = part.trim();
  if (text !== text.toUpperCase() || text.length <= 3) return text;
  return text.toLowerCase().replace(/(^|[\s.])\p{L}/gu, letter => letter.toUpperCase()).replace(/\.(?=\S)/g, '. ');
}

export function parseQuakeRegion(raw: string | null): QuakeRegion | null {
  const match = raw?.trim().match(REGION);
  if (!match) return null;
  const [, setting, distance, direction, rest] = match;
  const parts = rest.split(/\s*[-,]\s*/).filter(Boolean);
  if (parts.length > 1 && PREFIXES[parts[0].toUpperCase()]) parts.splice(0, 2, `${PREFIXES[parts[0].toUpperCase()]} ${tidy(parts[1])}`);
  const [place, ...area] = parts.map(tidy);
  return {
    distanceKm: distance.replace(',', '.'),
    direction: DIRECTIONS[direction.toLowerCase().replace(/\s+/g, '')],
    place,
    area: area.length ? area.join(', ') : null,
    setting: setting ? (setting.toLowerCase() === 'laut' ? 'sea' : 'land') : null,
  };
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10 };
function fromRoman(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = ROMAN[value[index]], next = ROMAN[value[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

// "Dirasakan" leads with the Modified Mercalli range ("II - III Kab. Gorontalo Utara"); keep the whole range.
export function parseFeltIntensity(raw: string | null): FeltIntensity | null {
  const match = raw?.match(/^([IVX]+)(?:\s*-\s*([IVX]+))?\b/);
  if (!match) return null;
  const [, from, to] = match;
  return { text: to ? `${from}-${to}` : from, from: fromRoman(from), to: to ? fromRoman(to) : null };
}
