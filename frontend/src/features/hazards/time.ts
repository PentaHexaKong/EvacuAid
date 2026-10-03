export type RelativeTime = { key: 'timeJustNow' | 'timeMinutes' | 'timeHours' | 'timeDays'; count: number };

// Future or unparseable timestamps (clock skew, bad feed data) read as "just now" rather than negative.
export function relativeTime(iso: string, now = Date.now()): RelativeTime {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return { key: 'timeJustNow', count: 0 };
  if (minutes < 60) return { key: 'timeMinutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? { key: 'timeHours', count: hours } : { key: 'timeDays', count: Math.floor(hours / 24) };
}
