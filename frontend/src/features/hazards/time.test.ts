import { relativeTime } from './time';

const now = Date.parse('2026-10-02T12:00:00Z');

test('relative time buckets and never goes negative or NaN', () => {
  expect(relativeTime('2026-10-02T11:59:40Z', now)).toEqual({ key: 'timeJustNow', count: 0 });
  expect(relativeTime('2026-10-02T11:15:00Z', now)).toEqual({ key: 'timeMinutes', count: 45 });
  expect(relativeTime('2026-10-02T09:00:00Z', now)).toEqual({ key: 'timeHours', count: 3 });
  expect(relativeTime('2026-09-29T12:00:00Z', now)).toEqual({ key: 'timeDays', count: 3 });
  expect(relativeTime('2026-10-02T13:00:00Z', now)).toEqual({ key: 'timeJustNow', count: 0 });
  expect(relativeTime('garbage', now)).toEqual({ key: 'timeJustNow', count: 0 });
});
