import { toJalali, jalaliMonthLength } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/jalali";
import type { Tenure } from "./shared";

// Working time shown as «X سال و Y ماه و Z روز» on the Jalali calendar. The
// backend (employee-tenure.ts) decides WHICH days count — the merged contract
// periods, up to today or the termination date; this only formats them. Each
// merged period is measured on the Jalali calendar (inclusive of both ends)
// and the pieces are summed; leftover days then roll into months at 30.
const DAY_MS = 24 * 60 * 60 * 1000;

function jalaliSpan(startIso: string, endIso: string): { years: number; months: number; days: number } {
  const start = toJalali(new Date(`${startIso}T00:00:00.000Z`));
  // Exclusive end = the day after the last counted day.
  const end = toJalali(new Date(new Date(`${endIso}T00:00:00.000Z`).getTime() + DAY_MS));
  let years = end.jy - start.jy;
  let months = end.jm - start.jm;
  let days = end.jd - start.jd;
  if (days < 0) {
    const prevMonth = end.jm === 1 ? 12 : end.jm - 1;
    const prevYear = end.jm === 1 ? end.jy - 1 : end.jy;
    days += jalaliMonthLength(prevYear, prevMonth);
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return { years, months, days };
}

export function tenureParts(tenure: Tenure): { years: number; months: number; days: number } {
  let years = 0;
  let months = 0;
  let days = 0;
  for (const period of tenure.periods) {
    const span = jalaliSpan(period.start, period.end);
    years += span.years;
    months += span.months;
    days += span.days;
  }
  months += Math.floor(days / 30);
  days %= 30;
  years += Math.floor(months / 12);
  months %= 12;
  return { years, months, days };
}

export function formatTenure(tenure: Tenure | null | undefined): string {
  if (!tenure || tenure.days <= 0) return "-";
  const { years, months, days } = tenureParts(tenure);
  const parts = [years > 0 ? `${toPersianDigits(years)} سال` : null, months > 0 ? `${toPersianDigits(months)} ماه` : null, days > 0 ? `${toPersianDigits(days)} روز` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" و ") : "کمتر از یک روز";
}

/** «۲۰ روز دیگر» / «۵ روز پیش منقضی شد» / «بدون پایان». */
export function formatExpiry(daysToExpiry: number | null): string {
  if (daysToExpiry === null) return "بدون تاریخ پایان";
  if (daysToExpiry < 0) return `${toPersianDigits(Math.abs(daysToExpiry))} روز پیش منقضی شد`;
  if (daysToExpiry === 0) return "امروز منقضی می‌شود";
  return `${toPersianDigits(daysToExpiry)} روز دیگر`;
}
