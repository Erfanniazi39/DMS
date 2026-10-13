// Business-calendar-day helpers shared across modules. Moved out of
// dashboard/dashboard.service.ts (Inventory build plan I4, §5.4a R10): the
// expiry report (Inventory) needs "today" on the same Tehran calendar day
// Dashboard already uses, and Inventory must not import from Dashboard (that
// would reverse the existing Dashboard → Inventory dependency direction from
// I3). Dashboard re-exports tehranToday() from here so its own behavior and
// public API are unchanged.

// The company operates in Iran — "today" is decided on the Tehran calendar
// day, not the server's own timezone.
const BUSINESS_TIMEZONE = 'Asia/Tehran';

const gregorianInTehran = new Intl.DateTimeFormat('en-US-u-nu-latn', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function partsOf(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// Today's Tehran calendar date, as UTC midnight (the same space business
// dates are stored in — see common/zod-fields.ts toIsoDay()).
export function tehranToday(now: Date = new Date()): Date {
  const { year, month, day } = partsOf(gregorianInTehran, now);
  return new Date(Date.UTC(year, month - 1, day));
}
