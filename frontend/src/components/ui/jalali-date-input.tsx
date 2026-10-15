"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { JALALI_MAX_YEAR, JALALI_MIN_YEAR, JALALI_MONTH_NAMES, jalaliMonthLength, safeToJalali, toGregorian, toJalali, toPersianDigits } from "@/lib/jalali";

type JalaliDateInputProps = {
  /** ISO date string "YYYY-MM-DD", or "" when empty. */
  value: string;
  onChange: (isoDate: string) => void;
  idPrefix: string;
  required?: boolean;
  minYear?: number;
  maxYear?: number;
  /** ISO date; days before it can't be picked (e.g. an expiry date can't precede its issue date). */
  minDate?: string;
};

type Panel = "year" | "month" | "day";

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"]; // Saturday first
const YEARS_PER_PAGE = 12;

function parseIso(value: string) {
  if (!value) return null;
  // A stored date outside the convertible Jalali range (e.g. 9999-12-31)
  // shows as unselected rather than crashing the form.
  return safeToJalali(new Date(`${value}T00:00:00`));
}

function toIso(jy: number, jm: number, jd: number) {
  const date = toGregorian(jy, jm, jd);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Saturday = 0 … Friday = 6 for the first day of a Jalali month.
function firstWeekdayOffset(jy: number, jm: number) {
  return (toGregorian(jy, jm, 1).getDay() + 1) % 7;
}

const cell =
  "flex h-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-30";
const cellSelected = "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground";

// Jalali (Shamsi) date input made of three rectangular fields — روز / ماه /
// سال. Clicking a field opens a small box under it: the day field shows that
// month's calendar, the month field the twelve month names, the year field
// twelve years at a time with previous/next arrows for the next twelve. No
// calendar library: the conversion lives in lib/jalali.ts, and the value it
// reports is always a standard Gregorian ISO date string, since that is what
// the database and API store.
//
// Year/month/day are kept as LOCAL state so a partial pick (year chosen,
// month/day not yet) survives re-renders; `onChange` only fires up to the
// parent once a full date can be computed (and with "" when it can't).
export function JalaliDateInput({ value, onChange, idPrefix, required, minYear = JALALI_MIN_YEAR, maxYear, minDate }: JalaliDateInputProps) {
  const today = toJalali(new Date());
  const minJalali = minDate ? parseIso(minDate) : null;
  // True when the given Jalali date falls before `minDate`.
  const beforeMin = (y: number, m: number, d: number) => minJalali !== null && (y !== minJalali.jy ? y < minJalali.jy : m !== minJalali.jm ? m < minJalali.jm : d < minJalali.jd);
  // Dates like birth/hire dates are never in the future, so the year list
  // stops at the current Jalali year unless the caller says otherwise. Either
  // way it never leaves the business range the backend accepts.
  const effectiveMinYear = Math.max(minYear, JALALI_MIN_YEAR, minJalali?.jy ?? 0);
  const effectiveMaxYear = Math.min(maxYear ?? today.jy, JALALI_MAX_YEAR);

  const initial = parseIso(value);
  const [jy, setJy] = useState<number | null>(initial?.jy ?? null);
  const [jm, setJm] = useState<number | null>(initial?.jm ?? null);
  const [jd, setJd] = useState<number | null>(initial?.jd ?? null);
  const [panel, setPanel] = useState<Panel | null>(null);
  // First year shown in the year box; null = derive from the selection.
  const [yearPageStart, setYearPageStart] = useState<number | null>(null);
  // Month shown in the day box (follows the selection, but the user may page).
  const [viewYear, setViewYear] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState<number | null>(null);

  // Stay in sync when the value changes from outside (loading a record into
  // an edit form, resetting after a save) — React's "adjust state while
  // rendering" pattern instead of an effect.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    const parsed = parseIso(value);
    setJy(parsed?.jy ?? null);
    setJm(parsed?.jm ?? null);
    setJd(parsed?.jd ?? null);
  }

  // After a year/month change the other parts may no longer fit `minDate`
  // (e.g. expiry 5 Mehr 1395, then year → 1394 with issue date 18 Aban 1394).
  // A month entirely before the minimum is cleared (with the day); a day
  // before the minimum is cleared on its own — never a date before it.
  function fit(year: number | null, month: number | null, day: number | null): [number | null, number | null] {
    if (year === null || month === null) return [month, day];
    const length = jalaliMonthLength(year, month);
    if (beforeMin(year, month, length)) return [null, null];
    if (day !== null && beforeMin(year, month, Math.min(day, length))) return [month, null];
    return [month, day];
  }

  function commit(nextYear: number | null, nextMonth: number | null, nextDay: number | null) {
    setJy(nextYear);
    setJm(nextMonth);
    if (nextYear === null || nextMonth === null || nextDay === null) {
      setJd(nextDay);
      onChange("");
      return;
    }
    const clampedDay = Math.min(nextDay, jalaliMonthLength(nextYear, nextMonth));
    setJd(clampedDay);
    onChange(toIso(nextYear, nextMonth, clampedDay));
  }

  function clearAll() {
    setJy(null);
    setJm(null);
    setJd(null);
    onChange("");
    setPanel(null);
  }

  function openPanel(next: Panel | null) {
    if (next === "year") setYearPageStart(null);
    if (next === "day") {
      setViewYear(jy ?? Math.min(Math.max(today.jy, effectiveMinYear), effectiveMaxYear));
      setViewMonth(jm ?? (jy === null || jy === today.jy ? today.jm : 1));
    }
    setPanel(next);
  }

  // --- year box -------------------------------------------------------------
  const anchorYear = jy ?? Math.min(Math.max(today.jy, effectiveMinYear), effectiveMaxYear);
  const lastStart = Math.max(effectiveMinYear, effectiveMaxYear - (YEARS_PER_PAGE - 1));
  const pageStart = Math.min(Math.max(yearPageStart ?? anchorYear - 6, effectiveMinYear), lastStart);
  const pageYears = Array.from({ length: YEARS_PER_PAGE }, (_, index) => pageStart + index);

  // --- day box --------------------------------------------------------------
  const shownYear = viewYear ?? anchorYear;
  const shownMonth = viewMonth ?? 1;
  const monthLength = jalaliMonthLength(shownYear, shownMonth);
  const offset = firstWeekdayOffset(shownYear, shownMonth);
  const dayCells: (number | null)[] = [...Array.from({ length: offset }, () => null), ...Array.from({ length: monthLength }, (_, index) => index + 1)];

  function shiftMonth(delta: number) {
    let year = shownYear;
    let month = shownMonth + delta;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    if (year < effectiveMinYear || year > effectiveMaxYear) return;
    setViewYear(year);
    setViewMonth(month);
  }

  // After a year/month pick, move on to whichever part is still empty (year →
  // month → day); close the box once the date is complete. A date is never
  // completed behind the user's back — the day stays empty until picked.
  function followOn(year: number | null, month: number | null, day: number | null) {
    if (year === null) return setPanel("year");
    if (month === null) return setPanel("month");
    if (day === null) {
      setViewYear(year);
      setViewMonth(month);
      return setPanel("day");
    }
    setPanel(null);
  }

  function pickDay(day: number) {
    commit(shownYear, shownMonth, day);
    setPanel(null);
  }

  function pickToday() {
    if (today.jy < effectiveMinYear || today.jy > effectiveMaxYear || beforeMin(today.jy, today.jm, today.jd)) return;
    commit(today.jy, today.jm, today.jd);
    setPanel(null);
  }

  const todayInRange = today.jy >= effectiveMinYear && today.jy <= effectiveMaxYear && !beforeMin(today.jy, today.jm, today.jd);

  function field(which: Panel, label: string, shown: string | null, popup: ReactNode) {
    return (
      <Popover.Root open={panel === which} onOpenChange={(open) => openPanel(open ? which : null)}>
        <Popover.Trigger
          id={`${idPrefix}-${which}`}
          aria-label={label}
          aria-required={required || undefined}
          className={cn(
            "flex h-9 flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring",
            shown === null && "text-muted-foreground",
          )}
        >
          <span className="truncate">{shown ?? label}</span>
          {which === "day" ? <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start" className="z-[70]">
            <Popover.Popup dir="rtl" className="rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none">
              {popup}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const yearBox = (
    <div className="w-56">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="دوازده سال قبل" disabled={pageStart <= effectiveMinYear} className={cn(cell, "w-8")} onClick={() => setYearPageStart(Math.max(effectiveMinYear, pageStart - YEARS_PER_PAGE))}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {toPersianDigits(pageYears[0])} تا {toPersianDigits(pageYears[pageYears.length - 1])}
        </span>
        <button type="button" aria-label="دوازده سال بعد" disabled={pageStart >= lastStart} className={cn(cell, "w-8")} onClick={() => setYearPageStart(Math.min(lastStart, pageStart + YEARS_PER_PAGE))}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {pageYears.map((year) => (
          <button
            key={year}
            type="button"
            disabled={year < effectiveMinYear || year > effectiveMaxYear}
            className={cn(cell, "tabular-nums", year === jy && cellSelected)}
            onClick={() => {
              const [month, day] = fit(year, jm, jd);
              commit(year, month, day);
              followOn(year, month, day);
            }}
          >
            {toPersianDigits(year)}
          </button>
        ))}
      </div>
    </div>
  );

  const monthBox = (
    <div className="w-56">
      <div className="grid grid-cols-3 gap-1">
        {JALALI_MONTH_NAMES.map((name, index) => (
          <button
            key={name}
            type="button"
            className={cn(cell, index + 1 === jm && cellSelected)}
            disabled={jy !== null && beforeMin(jy, index + 1, jalaliMonthLength(jy, index + 1))}
            onClick={() => {
              const [month, day] = fit(jy, index + 1, jd);
              commit(jy, month, day);
              followOn(jy, month, day);
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );

  const dayBox = (
    <div className="w-64">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="ماه قبل" className={cn(cell, "w-8")} onClick={() => shiftMonth(-1)}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium">
          {JALALI_MONTH_NAMES[shownMonth - 1]} {toPersianDigits(shownYear)}
        </span>
        <button type="button" aria-label="ماه بعد" className={cn(cell, "w-8")} onClick={() => shiftMonth(1)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="py-1">{weekday}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dayCells.map((day, index) =>
          day === null ? (
            <span key={`blank-${index}`} />
          ) : (
            <button
              key={day}
              type="button"
              disabled={beforeMin(shownYear, shownMonth, day)}
              className={cn(cell, "tabular-nums", jy === shownYear && jm === shownMonth && jd === day && cellSelected, today.jy === shownYear && today.jm === shownMonth && today.jd === day && !(jy === shownYear && jm === shownMonth && jd === day) && "ring-1 ring-primary/50")}
              onClick={() => pickDay(day)}
            >
              {toPersianDigits(day)}
            </button>
          ),
        )}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
        <button type="button" disabled={!todayInRange} className="rounded px-2 py-1 text-primary hover:bg-accent disabled:opacity-30" onClick={pickToday}>
          امروز
        </button>
        {!required ? (
          <button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-accent" onClick={clearAll}>
            پاک کردن
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex gap-2">
      {field("year", "سال", jy !== null ? toPersianDigits(jy) : null, yearBox)}
      {field("month", "ماه", jm !== null ? JALALI_MONTH_NAMES[jm - 1] : null, monthBox)}
      {field("day", "روز", jd !== null ? toPersianDigits(jd) : null, dayBox)}
    </div>
  );
}
