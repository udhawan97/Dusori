/**
 * Format a dated-update key without letting the viewer's time zone move it to another day.
 * Update paths are UTC calendar dates by contract, so their labels must use that same calendar.
 */
export function formatUtcCalendarDate(value: string, locales?: Intl.LocalesArgument): string {
  return new Intl.DateTimeFormat(locales, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}
