import type { Locator, Page } from "@playwright/test";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toFa = (value: number) => String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);

export const JALALI_MONTH_NAMES = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

// Drives the box-style JalaliDateInput (components/ui/jalali-date-input.tsx):
// the year field opens twelve years at a time with previous/next arrows; the
// month field opens the twelve names; the day field opens that month's
// calendar. `scope` limits the lookup to a dialog/section when needed.
export async function pickJalaliDate(page: Page, idPrefix: string, date: { year: number; month: number; day: number }, scope: Page | Locator = page) {
  await scope.locator(`#${idPrefix}-year`).click();
  const yearButton = page.getByRole("button", { name: toFa(date.year), exact: true });
  for (let step = 0; step < 40 && !(await yearButton.isVisible()); step += 1) {
    // The box shows "۱۳۹۹ تا ۱۴۱۰": compare the target with its first year.
    const label = await page.getByText(/^[۰-۹]{4} تا [۰-۹]{4}$/).first().innerText();
    const firstYear = Number([...label.split(" ")[0]].map((char) => PERSIAN_DIGITS.indexOf(char)).join(""));
    await page.getByRole("button", { name: date.year < firstYear ? "دوازده سال قبل" : "دوازده سال بعد" }).click();
  }
  await yearButton.click();
  await page.getByRole("button", { name: JALALI_MONTH_NAMES[date.month - 1], exact: true }).click();
  await page.getByRole("button", { name: toFa(date.day), exact: true }).click();
}
