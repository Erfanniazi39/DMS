import { test, expect, type Page } from "@playwright/test";

// Closes the "no E2E tests for Purchase Requests" coverage gap. Requester
// Department is the only mandatory reference (the seeded "MGMT" department
// is used throughout), so these tests don't depend on any Employee data
// existing — see purchase-request.dto.ts / PurchaseRequestForm.tsx.

test.describe.configure({ mode: "serial" });

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function openListPage(page: Page) {
  await page.goto("/admin/purchase-requests");
  await expect(page.getByRole("heading", { name: "درخواست‌های خرید" })).toBeVisible();
}

async function openCreatePage(page: Page) {
  // Scoped to <main> — the sidebar nav has its own "ثبت درخواست خرید" link
  // alongside this page's own button with the same accessible name.
  await page.getByRole("main").getByRole("button", { name: "ثبت درخواست خرید" }).click();
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
}

async function selectFirstDepartment(page: Page) {
  const select = page.locator("#request-department");
  await expect(select.locator("option").nth(1)).toBeAttached();
  const value = await select.locator("option").nth(1).getAttribute("value");
  if (!value) throw new Error("No active department is seeded — required for this test.");
  await select.selectOption(value);
}

async function selectJalaliDate(page: Page, idPrefix: string, date: { year: number; month: number; day: number }) {
  await page.locator(`#${idPrefix}-year`).selectOption(String(date.year));
  await page.locator(`#${idPrefix}-month`).selectOption(String(date.month));
  await page.locator(`#${idPrefix}-day`).selectOption(String(date.day));
}

async function fillFirstItem(page: Page, values: { name: string; quantity: string }) {
  const row = page.locator("table tbody tr").first();
  await row.getByLabel("نام یا شرح قلم").fill(values.name);
  await row.getByLabel("مقدار").fill(values.quantity);
  const unitSelect = row.getByLabel("واحد");
  const unitValue = await unitSelect.locator("option").nth(1).getAttribute("value");
  if (!unitValue) throw new Error("No unit is seeded — required for this test.");
  await unitSelect.selectOption(unitValue);
}

async function createPurchaseRequest(page: Page, itemName: string) {
  await openCreatePage(page);
  await selectJalaliDate(page, "request-date", { year: 1404, month: 1, day: 1 });
  await selectFirstDepartment(page);
  await fillFirstItem(page, { name: itemName, quantity: "10" });
  // Not getByRole("button", { name: ... }) — the sidebar has its own
  // same-named quick-create button; the real submit button is uniquely
  // identified by its form="purchase-request-form" association instead.
  await page.locator('button[form="purchase-request-form"]').click();
  await expect(
    page.getByRole("status").filter({ hasText: "درخواست خرید جدید با موفقیت ثبت شد." }),
  ).toBeVisible();
  await page.waitForURL(/\/admin\/purchase-requests\/\d+$/);
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("جستجو بر اساس شماره درخواست").fill(query);
}

test.beforeEach(async ({ page }) => {
  await openListPage(page);
});

test("1) creating a purchase request with valid data succeeds and appears in the list", async ({ page }) => {
  const itemName = `قلم آزمایشی ${uniqueSuffix()}`;
  await createPurchaseRequest(page, itemName);

  await openListPage(page);
  const row = page.locator("tbody tr").filter({ hasText: itemName });
  await expect(row).toHaveCount(1);
  // A server-generated REQ-###### number, not something the client supplied.
  await expect(row.first().locator("td").nth(1)).toHaveText(/^REQ-\d+$/);
});

test("2) submitting with no items filled in is rejected client-side, without hitting the server", async ({ page }) => {
  await openCreatePage(page);
  await selectJalaliDate(page, "request-date", { year: 1404, month: 1, day: 1 });
  await selectFirstDepartment(page);
  // No item name filled in — the one default empty row is filtered out
  // before the "at least one item" check runs (see PurchaseRequestForm.submit()).
  await page.locator('button[form="purchase-request-form"]').click();

  await expect(page.getByRole("alert").filter({ hasText: "حداقل یک قلم کالا را وارد کنید." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
});

test("2b) leaving the date and department empty shows the app's Persian message, not the browser's native tooltip", async ({ page }) => {
  // The <form> is `noValidate`, so native constraint validation doesn't
  // pre-empt PurchaseRequestForm.submit()'s own check — which still blocks.
  await openCreatePage(page);
  await page.locator('button[form="purchase-request-form"]').click();

  await expect(
    page.getByRole("alert").filter({ hasText: "تاریخ درخواست و دپارتمان درخواست‌کننده الزامی است." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/purchase-requests\/new/);
});

test("3) editing a purchase request's note and priority succeeds and persists", async ({ page }) => {
  const itemName = `قلم ویرایش ${uniqueSuffix()}`;
  await createPurchaseRequest(page, itemName);

  await openListPage(page);
  const row = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش درخواست خرید" })).toBeVisible();

  const note = `یادداشت ویرایش‌شده ${uniqueSuffix()}`;
  await page.locator("#request-note").fill(note);
  await page.locator("#request-priority").selectOption("URGENT");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "درخواست خرید با موفقیت ویرایش شد." }),
  ).toBeVisible();

  await openListPage(page);
  const updatedRow = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await expect(updatedRow).toContainText("فوری");
});
