import { describe, expect, it } from 'vitest';

import { formatUtcCalendarDate } from './calendar-date';

describe('formatUtcCalendarDate', () => {
  it.each([
    ['America/Chicago', '2026-03-08', 'Mar 8'],
    ['America/Chicago', '2026-11-01', 'Nov 1'],
    ['Pacific/Auckland', '2026-08-03', 'Aug 3'],
  ])('keeps the UTC key in %s across calendar and DST boundaries', (zone, date, label) => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      expect(formatUtcCalendarDate(date, 'en-US')).toBe(label);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
