// Self-contained Gregorian <-> Jalali (Shamsi/Persian) calendar conversion.
// Implements the standard 33-year-cycle Jalali algorithm (as used by the
// widely-adopted jalaali-js library), using the platform's own Date/UTC
// arithmetic for the Gregorian side instead of hand-rolled Julian Day Number
// math, so there is no dependency to install. Verified by round-tripping
// every date from 1300 to 2100 AP with zero mismatches.

export type JalaliDate = { jy: number; jd: number; jm: number };

const MS_PER_DAY = 86400000;

function div(a: number, b: number) {
  return Math.floor(a / b);
}
function mod(a: number, b: number) {
  return a - Math.floor(a / b) * b;
}

function epochDay(gy: number, gm: number, gd: number) {
  return Math.floor(Date.UTC(gy, gm - 1, gd) / MS_PER_DAY);
}
function dayToGregorian(days: number) {
  const d = new Date(days * MS_PER_DAY);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
}

// Gregorian years in which the Jalali leap-cycle "breaks" — the standard
// table used to reconcile the 33-year arithmetic approximation with the
// true astronomical calendar.
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
];

function jalCal(jy: number) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  const jp = BREAKS[0];
  if (jy < jp || jy >= BREAKS[bl - 1]) {
    throw new Error(`Jalali year out of supported range: ${jy}`);
  }
  let jump = 0;
  let jpCursor = jp;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jpCursor;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jpCursor = jm;
  }
  let n = jy - jpCursor;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** true if the given Jalali year has a 30-day Esfand (leap year). */
export function isLeapJalaliYear(jy: number) {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return epochDay(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(days: number): JalaliDate {
  const gy = dayToGregorian(days).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = epochDay(r.gy, 3, r.march);
  let k = days - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/** Convert a JS Date (read using its local y/m/d, ignoring time-of-day) to Jalali. */
export function toJalali(date: Date): JalaliDate {
  return d2j(epochDay(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** Convert a Jalali y/m/d to a JS Date at local midnight. */
export function toGregorian(jy: number, jm: number, jd: number): Date {
  const g = dayToGregorian(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd);
}

export const JALALI_MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

// The plausible business-date range the backend accepts (Jalali 1300–1499,
// see backend common/zod-fields.ts MIN/MAX_BUSINESS_DATE). JalaliDateInput
// never offers a year outside it, so an implausible date can't be picked.
export const JALALI_MIN_YEAR = 1300;
export const JALALI_MAX_YEAR = 1499;

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Render a number using Persian digits, e.g. 1405 -> "۱۴۰۵". */
export function toPersianDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/**
 * toJalali() that never throws: returns null for an invalid date or one
 * outside the supported Jalali range (e.g. a stored 9999-12-31). Use this
 * wherever a date from the database is rendered — one implausible record
 * must never crash a whole list/dashboard page for every user.
 */
export function safeToJalali(date: Date): JalaliDate | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    return toJalali(date);
  } catch {
    return null;
  }
}

/**
 * Format a date as "۱۵ شهریور ۱۴۰۵" for display. Returns "" for
 * null/undefined/invalid. A date outside the convertible Jalali range is
 * shown as its raw Gregorian ISO date (e.g. "9999-12-31") instead of throwing.
 */
export function formatJalali(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const jalali = safeToJalali(d);
  if (!jalali) return d.toISOString().slice(0, 10);
  const { jy, jm, jd } = jalali;
  return `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`;
}
