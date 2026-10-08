const kilometerFormats = new Map<string, Intl.NumberFormat>();

export function formatDistance(meters: number, locale: string) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const format = kilometerFormats.get(locale) ?? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  kilometerFormats.set(locale, format);
  return `${format.format(meters / 1000)} km`;
}
