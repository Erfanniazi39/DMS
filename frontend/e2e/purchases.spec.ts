import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Closes the "no E2E tests for Purchases" coverage gap. An OPERATIONAL
// purchase needs an active Requester Department (the seeded "MGMT") and an
// active Buyer Employee, so each test that needs one creates it directly
// through the backend API first (arrange), then drives the real Purchase
// form through the browser (act/assert) — the same session cookie from
// auth.setup.ts is reused automatically since `request` shares the
// browser context. HISTORICAL_IMPORT purchases deliberately need neither,
// per PurchasesService / purchase.dto.ts, and are used to test that rule
// directly.

test.describe.configure({ mode: "serial" });

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function uniqueDigits(length: number): string {
  const source = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return source.slice(-length).padStart(length, "0");
}

async function createActiveEmployee(request: APIRequestContext): Promise<number> {
  const departments = await (await request.get("http://localhost:3001/departments")).json();
  const department = (departments as Array<{ id: number; status: string }>).find((d) => d.status === "active");
  if (!department) throw new Error("No active department is seeded — required for this test.");

  const response = await request.post("http://localhost:3001/employees", {
    data: {
      firstName: "علی",
      lastName: "رضایی",
      departmentId: department.id,
      nationalId: uniqueDigits(10),
      mobilePhone: `09${uniqueDigits(9)}`,
      birthDate: "1990-01-01",
      hireDate: "2020-01-01",
    },
  });
  if (!response.ok()) throw new Error(`Failed to create employee: ${response.status()} ${await response.text()}`);
  const created = (await response.json()) as { id: number };
  return created.id;
}

async function openListPage(page: Page) {
  await page.goto("/purchases");
  await expect(page.getByRole("heading", { name: "خریدها" })).toBeVisible();
}

async function openCreatePage(page: Page) {
  await page.getByRole("button", { name: "خرید جدید" }).click();
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
}

async function selectJalaliDate(page: Page, idPrefix: string, date: { year: number; month: number; day: number }) {
  await page.locator(`#${idPrefix}-year`).selectOption(String(date.year));
  await page.locator(`#${idPrefix}-month`).selectOption(String(date.month));
  await page.locator(`#${idPrefix}-day`).selectOption(String(date.day));
}

async function selectFirstRealOption(page: Page, selectId: string) {
  const select = page.locator(`#${selectId}`);
  await expect(select.locator("option").nth(1)).toBeAttached();
  const value = await select.locator("option").nth(1).getAttribute("value");
  if (!value) throw new Error(`No option is available for #${selectId}.`);
  await select.selectOption(value);
  return value;
}

async function fillFirstItem(page: Page, values: { name: string; quantity: string; totalPrice: string }) {
  const row = page.locator("table tbody tr").first();
  await row.getByLabel("نام یا شرح قلم").fill(values.name);
  await row.getByLabel("مقدار").fill(values.quantity);
  await row.getByLabel("قیمت کل").fill(values.totalPrice);
  // exact: true — "واحد" is otherwise a substring match of the adjacent
  // "قیمت واحد (اختیاری)" textbox's own aria-label too.
  const unitSelect = row.getByLabel("واحد", { exact: true });
  const unitValue = await unitSelect.locator("option").nth(1).getAttribute("value");
  if (!unitValue) throw new Error("No unit is seeded — required for this test.");
  await unitSelect.selectOption(unitValue);
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("شماره خرید یا تأمین‌کننده").fill(query);
}

// The list is paginated (20 per page, newest purchaseDate first), so a just-
// created purchase — especially an old-dated historical one — is not
// guaranteed to be on page 1. Takes the purchase's detail-page URL (defaults
// to the current one, right after saving), reads its server-generated
// number, then opens the list filtered down to it.
async function openListPageForCurrentPurchase(page: Page, detailUrl = page.url()) {
  const id = new URL(detailUrl).pathname.split("/").pop();
  const response = await page.request.get(`http://localhost:3001/purchases/${id}`);
  if (!response.ok()) throw new Error(`Failed to load purchase ${id}: ${response.status()}`);
  const { purchaseNumber } = (await response.json()) as { purchaseNumber: string };
  await openListPage(page);
  await searchFor(page, purchaseNumber);
}

test.beforeEach(async ({ page }) => {
  await openListPage(page);
});

test("1) creating an OPERATIONAL purchase with valid data succeeds and appears in the list", async ({ page, request }) => {
  const employeeId = await createActiveEmployee(request);
  const itemName = `قلم خرید ${uniqueSuffix()}`;

  await openCreatePage(page);
  await selectJalaliDate(page, "purchase-date", { year: 1404, month: 1, day: 1 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await selectFirstRealOption(page, "purchase-department");
  await page.locator("#purchase-buyer").selectOption(String(employeeId));
  await fillFirstItem(page, { name: itemName, quantity: "5", totalPrice: "500000" });
  // Not getByRole("button", { name: "ثبت خرید" }) — the sidebar has its own
  // same-named quick-create button; button[form="purchase-form"] is unique.
  await page.locator('button[form="purchase-form"]').click();

  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchases\/\d+$/);

  await openListPageForCurrentPurchase(page);
  const row = page.locator("tbody tr").filter({ hasText: itemName });
  await expect(row).toHaveCount(1);
  // A server-generated PUR-###### number, never accepted from the client
  // (see CLAUDE.md's "document numbers" stack convention).
  await expect(row.first().locator("td").first()).toHaveText(/^PUR-\d+$/);
  // A brand-new purchase always starts as DRAFT (PurchasesService.create()).
  await expect(row.first()).toContainText("پیش‌نویس");
});

test("2) creating a HISTORICAL_IMPORT purchase without a department or buyer succeeds (never fabricated)", async ({ page }) => {
  const itemName = `قلم تاریخی ${uniqueSuffix()}`;

  await openCreatePage(page);
  await page.locator("#purchase-source-type").selectOption("HISTORICAL_IMPORT");
  await selectJalaliDate(page, "purchase-date", { year: 1390, month: 1, day: 1 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await fillFirstItem(page, { name: itemName, quantity: "1", totalPrice: "10000" });
  // Department/buyer are left blank on purpose — HISTORICAL_IMPORT allows it.
  await page.locator('button[form="purchase-form"]').click();

  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchases\/\d+$/);

  await openListPageForCurrentPurchase(page);
  const row = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await expect(row).toContainText("ثبت تاریخی");
});

test("3) submitting an OPERATIONAL purchase with no items filled in is rejected client-side", async ({ page, request }) => {
  const employeeId = await createActiveEmployee(request);

  await openCreatePage(page);
  await selectJalaliDate(page, "purchase-date", { year: 1404, month: 1, day: 1 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await selectFirstRealOption(page, "purchase-department");
  await page.locator("#purchase-buyer").selectOption(String(employeeId));
  // The one default item row is left with an empty name — filtered out
  // before the "at least one item" check runs (see PurchaseForm.submit()).
  await page.locator('button[form="purchase-form"]').click();

  await expect(page.getByRole("alert").filter({ hasText: "حداقل یک قلم کالا را وارد کنید." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
});

test("3b) leaving required header fields empty shows the app's Persian message, not the browser's native tooltip", async ({ page }) => {
  // The <form> is `noValidate`, so native constraint validation on the
  // `required` <select>s / JalaliDateInput no longer pre-empts
  // PurchaseForm.submit()'s own check — which still blocks the submit.
  await openCreatePage(page);
  await page.locator('button[form="purchase-form"]').click();

  await expect(page.getByRole("alert").filter({ hasText: "همه فیلدهای اطلاعات خرید الزامی است." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
  await expect(page).toHaveURL(/\/\/[^/]+\/purchases\/new/);
});

test("4) editing a purchase's note and status succeeds and persists", async ({ page, request }) => {
  const employeeId = await createActiveEmployee(request);
  const itemName = `قلم ویرایش خرید ${uniqueSuffix()}`;

  await openCreatePage(page);
  await selectJalaliDate(page, "purchase-date", { year: 1404, month: 1, day: 1 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await selectFirstRealOption(page, "purchase-department");
  await page.locator("#purchase-buyer").selectOption(String(employeeId));
  await fillFirstItem(page, { name: itemName, quantity: "2", totalPrice: "20000" });
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchases\/\d+$/);
  const detailUrl = page.url();

  await openListPageForCurrentPurchase(page);
  const row = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش خرید" })).toBeVisible();

  await page.locator("#purchase-status").selectOption("CONFIRMED");
  const note = `یادداشت ویرایش‌شده ${uniqueSuffix()}`;
  await page.locator("#purchase-note").fill(note);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(page.getByRole("status").filter({ hasText: "خرید با موفقیت ویرایش شد." })).toBeVisible();

  await openListPageForCurrentPurchase(page, detailUrl);
  const updatedRow = page.locator("tbody tr").filter({ hasText: itemName }).first();
  await expect(updatedRow).toContainText("تأییدشده");
});

// Creates a minimal (DRAFT) Purchase Request straight through the API, just
// so the Purchase form's "درخواست خرید مرتبط" picker has a known option.
async function createPurchaseRequestViaApi(request: APIRequestContext, itemName: string): Promise<{ id: number; requestNumber: string }> {
  const departments = (await (await request.get("http://localhost:3001/departments")).json()) as Array<{ id: number; status: string }>;
  const department = departments.find((d) => d.status === "active");
  const units = (await (await request.get("http://localhost:3001/units")).json()) as Array<{ id: number }>;
  if (!department || units.length === 0) throw new Error("An active department and a unit must be seeded for this test.");
  const response = await request.post("http://localhost:3001/purchase-requests", {
    data: {
      requestDate: "2025-03-21",
      requesterDepartmentId: department.id,
      priority: "NORMAL",
      items: [{ name: itemName, quantity: 1, unitId: units[0].id }],
    },
  });
  if (!response.ok()) throw new Error(`Failed to create purchase request: ${response.status()} ${await response.text()}`);
  return (await response.json()) as { id: number; requestNumber: string };
}

test("5) the related-purchase-request picker is labeled richly, hidden for HISTORICAL_IMPORT, and cleared on switch", async ({ page, request }) => {
  const itemName = `قلم درخواست ${uniqueSuffix()}`;
  const created = await createPurchaseRequestViaApi(request, itemName);

  await openCreatePage(page);
  const picker = page.locator("#purchase-request");
  await expect(picker).toBeVisible();
  // Label = code + department + first item + Jalali date, not just the code.
  const option = picker.locator(`option[value="${created.id}"]`);
  await expect(option).toBeAttached();
  await expect(option).toContainText(created.requestNumber);
  await expect(option).toContainText(itemName);
  await expect(option).toContainText("۱۴۰۴");
  await picker.selectOption(String(created.id));

  await page.locator("#purchase-source-type").selectOption("HISTORICAL_IMPORT");
  await expect(page.locator("#purchase-request")).toHaveCount(0);

  // Switching back must not resurrect the stale selection.
  await page.locator("#purchase-source-type").selectOption("OPERATIONAL");
  await expect(page.locator("#purchase-request")).toHaveValue("");
});

test("6) a file picked on the create form is uploaded as a purchase document right after saving", async ({ page }) => {
  const itemName = `قلم با سند ${uniqueSuffix()}`;

  await openCreatePage(page);
  await page.locator("#purchase-source-type").selectOption("HISTORICAL_IMPORT");
  await selectJalaliDate(page, "purchase-date", { year: 1395, month: 6, day: 10 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await fillFirstItem(page, { name: itemName, quantity: "1", totalPrice: "250000" });

  // A file type the backend rejects is refused at pick time, before saving.
  await page.locator("#purchase-documents").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: "notes.txt" })).toBeVisible();

  await page.locator("#purchase-documents").setInputFiles({
    name: "scanned-invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  const staged = page.getByRole("list", { name: "اسناد انتخاب‌شده" });
  await expect(staged.locator("li")).toHaveCount(1);
  await expect(staged).toContainText("scanned-invoice.pdf");
  await staged.getByLabel("شماره سند scanned-invoice.pdf").fill("INV-77");

  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchases\/\d+$/);

  // The detail page's documents table lists it, with a downloadable file.
  const documentRow = page.locator("tbody tr").filter({ hasText: "INV-77" });
  await expect(documentRow).toHaveCount(1);
  await expect(documentRow).toContainText("فاکتور");
  await expect(documentRow.getByRole("link", { name: "مشاهده" })).toHaveAttribute("href", /^\/api\/uploads\/purchases\/.+\.pdf$/);
});
