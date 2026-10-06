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
  await page.goto("/purchase-requests");
  await expect(page.getByRole("heading", { name: "درخواست‌های خرید" })).toBeVisible();
}

// The list is paginated (newest requestDate first) and these tests date
// their requests 1404-01-01, so a freshly created row is generally NOT on
// page 1. Narrow the list to it via the search box (matches the request
// number) instead of assuming it's visible on the first page.
async function openListFilteredTo(page: Page, requestNumber: string) {
  await openListPage(page);
  await page.getByPlaceholder("جستجو بر اساس شماره درخواست").fill(requestNumber);
  await expect(page.locator("tbody tr").filter({ hasText: requestNumber })).toHaveCount(1);
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

async function selectFirstPurchaseType(page: Page) {
  const select = page.locator("#request-purchase-type");
  await expect(select.locator("option").nth(1)).toBeAttached();
  const value = await select.locator("option").nth(1).getAttribute("value");
  if (!value) throw new Error("No active purchase type is seeded — required for this test.");
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

// Returns the server-generated request number (read from the detail page
// heading the form redirects to).
async function createPurchaseRequest(page: Page, itemName: string): Promise<string> {
  await openCreatePage(page);
  await selectJalaliDate(page, "request-date", { year: 1404, month: 1, day: 1 });
  await selectFirstPurchaseType(page);
  await selectFirstDepartment(page);
  await fillFirstItem(page, { name: itemName, quantity: "10" });
  // Not getByRole("button", { name: ... }) — the sidebar has its own
  // same-named quick-create button; the real submit button is uniquely
  // identified by its form="purchase-request-form" association instead.
  await page.locator('button[form="purchase-request-form"]').click();
  await expect(
    page.getByRole("status").filter({ hasText: "درخواست خرید جدید با موفقیت ثبت شد." }),
  ).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchase-requests\/\d+$/);
  const heading = await page.getByRole("heading", { level: 1, name: /^درخواست خرید REQ-\d+$/ }).innerText();
  return heading.replace("درخواست خرید", "").trim();
}

test.beforeEach(async ({ page }) => {
  await openListPage(page);
});

test("1) creating a purchase request with valid data succeeds and appears in the list", async ({ page }) => {
  const itemName = `قلم آزمایشی ${uniqueSuffix()}`;
  const requestNumber = await createPurchaseRequest(page, itemName);

  await openListFilteredTo(page, requestNumber);
  const row = page.locator("tbody tr").filter({ hasText: itemName });
  await expect(row).toHaveCount(1);
  // A server-generated REQ-###### number, not something the client supplied.
  await expect(row.first().locator("td").nth(1)).toHaveText(/^REQ-\d+$/);
});

test("2) submitting with no items filled in is rejected client-side, without hitting the server", async ({ page }) => {
  await openCreatePage(page);
  await selectJalaliDate(page, "request-date", { year: 1404, month: 1, day: 1 });
  await selectFirstPurchaseType(page);
  await selectFirstDepartment(page);
  // No item name filled in — the one default empty row is filtered out
  // before the "at least one item" check runs (see PurchaseRequestForm.submit()).
  await page.locator('button[form="purchase-request-form"]').click();

  await expect(page.getByRole("alert").filter({ hasText: "حداقل یک قلم کالا را وارد کنید." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
});

test("2b) leaving the date, purchase type and department empty shows the app's Persian message, not the browser's native tooltip", async ({ page }) => {
  // The <form> is `noValidate`, so native constraint validation doesn't
  // pre-empt PurchaseRequestForm.submit()'s own check — which still blocks.
  await openCreatePage(page);
  await page.locator('button[form="purchase-request-form"]').click();

  await expect(
    page.getByRole("alert").filter({ hasText: "تاریخ درخواست، نوع خرید و دپارتمان درخواست‌کننده الزامی است." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
  await expect(page).toHaveURL(/\/\/[^/]+\/purchase-requests\/new/);
});

test("3) editing a purchase request's note and priority succeeds and persists", async ({ page }) => {
  const itemName = `قلم ویرایش ${uniqueSuffix()}`;
  const requestNumber = await createPurchaseRequest(page, itemName);

  await openListFilteredTo(page, requestNumber);
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

  await openListFilteredTo(page, requestNumber);
  const updatedRow = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await expect(updatedRow).toContainText("فوری");
});
