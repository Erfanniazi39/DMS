"use client";

import { useState } from "react";
import { JALALI_MAX_YEAR, JALALI_MIN_YEAR, JALALI_MONTH_NAMES, jalaliMonthLength, safeToJalali, toGregorian, toJalali, toPersianDigits } from "@/lib/jalali";

type JalaliDateInputProps = {
  /** ISO date string "YYYY-MM-DD", or "" when empty. */
  value: string;
  onChange: (isoDate: string) => void;
  idPrefix: string;
  required?: boolean;
  minYear?: number;
  maxYear?: number;
};

function parseIso(value: string) {
  if (!value) return null;
  // A stored date outside the convertible Jalali range (e.g. 9999-12-31)
  // shows as unselected rather than crashing the form.
  return safeToJalali(new Date(`${value}T00:00:00`));
}

// Three plain <select> dropdowns (year/month/day) backed by the Jalali
// (Shamsi) calendar. No calendar-popup library is used, so this works
// without any additional install — the value it reports is always a
// standard Gregorian ISO date string, since that's what the database
// and API store.
//
// Year/month/day are kept as LOCAL component state rather than derived
// fresh from `value` on every render. Deriving straight from `value` meant
// a partial pick (year chosen, month/day not yet chosen) was thrown away on
// every render because the parent's `value` was still "" — so the dropdown
// looked like it "didn't select" anything. Local state remembers each
// selection immediately; `onChange` only fires up to the parent once a full
// date can be computed.
export function JalaliDateInput({ value, onChange, idPrefix, required, minYear = JALALI_MIN_YEAR, maxYear }: JalaliDateInputProps) {
  const currentJalaliYear = toJalali(new Date()).jy;
  // Dates in this app (birth date, hire date) are never in the future, so
  // the year list stops at the current Jalali year unless the caller says
  // otherwise. Either way the list never leaves the plausible business range
  // (JALALI_MIN_YEAR–JALALI_MAX_YEAR) the backend accepts.
  const effectiveMinYear = Math.max(minYear, JALALI_MIN_YEAR);
  const effectiveMaxYear = Math.min(maxYear ?? currentJalaliYear, JALALI_MAX_YEAR);

  const initial = parseIso(value);
  const [jy, setJy] = useState<number | null>(initial?.jy ?? null);
  const [jm, setJm] = useState<number | null>(initial?.jm ?? null);
  const [jd, setJd] = useState<number | null>(initial?.jd ?? null);

  // Stay in sync when the value changes from outside this component —
  // loading an employee into the edit form, or resetting the form back to
  // empty after a save. Re-parsed during render whenever `value` differs
  // from the last one seen (React's "adjusting state when props change"
  // pattern) instead of in an effect — same trigger (any change of `value`),
  // same result, without the extra render pass.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    const parsed = parseIso(value);
    setJy(parsed?.jy ?? null);
    setJm(parsed?.jm ?? null);
    setJd(parsed?.jd ?? null);
  }

  const years: number[] = [];
  for (let year = effectiveMaxYear; year >= effectiveMinYear; year -= 1) years.push(year);

  const dayCount = jy !== null && jm !== null ? jalaliMonthLength(jy, jm) : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  function apply(nextYear: number | null, nextMonth: number | null, nextDay: number | null) {
    setJy(nextYear);
    setJm(nextMonth);
    if (nextYear === null || nextMonth === null || nextDay === null) {
      setJd(nextDay);
      onChange("");
      return;
    }
    const maxDay = jalaliMonthLength(nextYear, nextMonth);
    const clampedDay = Math.min(nextDay, maxDay);
    setJd(clampedDay);
    const date = toGregorian(nextYear, nextMonth, clampedDay);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    onChange(iso);
  }

  return (
    <div className="flex gap-2">
      <select
        id={`${idPrefix}-year`}
        aria-label="سال"
        className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
        value={jy ?? ""}
        onChange={(event) => apply(event.target.value ? Number(event.target.value) : null, jm, jd ?? 1)}
        required={required}
      >
        <option value="">سال</option>
        {years.map((year) => (
          <option key={year} value={year}>{toPersianDigits(year)}</option>
        ))}
      </select>
      <select
        id={`${idPrefix}-month`}
        aria-label="ماه"
        className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
        value={jm ?? ""}
        onChange={(event) => apply(jy, event.target.value ? Number(event.target.value) : null, jd ?? 1)}
        required={required}
      >
        <option value="">ماه</option>
        {JALALI_MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>{name}</option>
        ))}
      </select>
      <select
        id={`${idPrefix}-day`}
        aria-label="روز"
        className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
        value={jd ?? ""}
        onChange={(event) => apply(jy, jm, event.target.value ? Number(event.target.value) : null)}
        required={required}
      >
        <option value="">روز</option>
        {days.map((day) => (
          <option key={day} value={day}>{toPersianDigits(day)}</option>
        ))}
      </select>
    </div>
  );
}
