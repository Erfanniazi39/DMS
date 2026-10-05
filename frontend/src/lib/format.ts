// App-wide value formatting helpers. Jalali date display lives separately in
// lib/jalali.ts (formatJalali, toPersianDigits).

/** Rial amounts arrive from the API as Prisma Decimal → JSON strings. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("fa-IR");
}

/**
 * Today's date as a local-time "YYYY-MM-DD" string — the default value for
 * date fields that usually record something happening now (purchase date,
 * request date, hire date). Still a plain editable field afterwards.
 */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
