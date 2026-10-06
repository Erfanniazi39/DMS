import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";

// Adversarial UI regression suite for the Purchase / Purchase Request
// workflow, written during the 2026-10-05 frontend QA pass. Focus areas:
//
// - The request-edit-wipes-fulfillment-links bug (editing a Purchase Request,
//   including via the تایید/رد shortcut buttons, used to delete and recreate
//   its lines, silently resetting purchased quantities to 0). Every test here
//   that edits a request checks that purchased/remaining quantities and the
//   system-computed status SURVIVE the edit.
// - The "درخواست خرید مرتبط" picker on /purchases/new (custom Base UI Select
//   with an inline replace-confirmation banner — two earlier bugs there left
//   an invisible overlay blocking the page).
// - Payments / documents / returns as seen from the purchase detail page.
// - Permission-based hiding of mutating actions.
//
// Unlike purchases.spec.ts / purchase-request-fulfillment.spec.ts, these
// tests do NOT create a new Employee per run (that left ~200 throwaway
// employees in the dev DB) — they reuse the first existing active employee,
// department and unit. They still create real purchase requests/purchases
// (that is what is under test); every created record carries "QA-UI" in its
// note so it can be found and cleaned up later.
//
// Tests are independent (not serial): one failure does not skip the rest.
// Tests that document a currently-open defect are marked with test.fail() and
// a "BUG:" comment — when the bug is fixed Playwright reports them as an
// unexpected pass, which is the signal to drop the test.fail() marker.

const BACKEND = "http://localhost:3001";
const QA_NOTE = "QA-UI خودکار — قابل حذف";

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function fa(value: number): string {
  return value.toLocaleString("fa-IR");
}

type MasterData = { departmentId: number; employeeId: number; unitId: number; unitName: string; purchaseTypeId: number };

let cachedMasterData: MasterData | null = null;

async function masterData(request: APIRequestContext): Promise<MasterData> {
  if (cachedMasterData) return cachedMasterData;
  const departments = (await (await request.get(`${BACKEND}/departments`)).json()) as Array<{ id: number; status: string }>;
  const employees = (await (await request.get(`${BACKEND}/employees`)).json()) as Array<{ id: number; status: string }>;
  const units = (await (await request.get(`${BACKEND}/units`)).json()) as Array<{ id: number; nameFa: string; code: string }>;
  // Active types only, lowest sort order first (GET /purchase-types).
  const purchaseTypes = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const department = departments.find((d) => d.status === "active");
  const employee = employees.find((e) => e.status === "active");
  const unit = units.find((u) => u.code === "liter") ?? units[0];
  if (!department || !employee || !unit || purchaseTypes.length === 0) {
    throw new Error("An active department, an active employee, a unit and an active purchase type must exist for these tests.");
  }
  cachedMasterData = { departmentId: department.id, employeeId: employee.id, unitId: unit.id, unitName: unit.nameFa, purchaseTypeId: purchaseTypes[0].id };
  return cachedMasterData;
}

type RequestItemInput = { name: string; quantity: number };

async function createRequestViaApi(
  request: APIRequestContext,
  items: RequestItemInput[],
  options: { approve: boolean } = { approve: true },
): Promise<{ id: number; requestNumber: string }> {
  const md = await masterData(request);
  const payload = {
    requestDate: new Date().toISOString().slice(0, 10),
    purchaseTypeId: md.purchaseTypeId,
    requesterDepartmentId: md.departmentId,
    priority: "NORMAL",
    note: QA_NOTE,
    items: items.map((item) => ({ name: item.name, quantity: item.quantity, unitId: md.unitId })),
  };
  const created = await request.post(`${BACKEND}/purchase-requests`, { data: payload });
  if (!created.ok()) throw new Error(`Failed to create purchase request: ${created.status()} ${await created.text()}`);
  const body = (await created.json()) as { id: number; requestNumber: string; updatedAt: string; items: { id: number }[] };
  if (options.approve) {
    // updatedAt = the optimistic-locking token every PATCH must send back.
    const approved = await request.patch(`${BACKEND}/purchase-requests/${body.id}`, {
      data: { ...payload, status: "APPROVED", updatedAt: body.updatedAt, items: payload.items.map((item, index) => ({ ...item, id: body.items[index].id })) },
    });
    if (!approved.ok()) throw new Error(`Failed to approve purchase request: ${approved.status()} ${await approved.text()}`);
  }
  return { id: body.id, requestNumber: body.requestNumber };
}

type PurchaseStatusValue = "DRAFT" | "CONFIRMED" | "RECEIVED" | "CLOSED" | "CANCELLED";

// New purchases are created CONFIRMED by default, or DRAFT on request (the
// only two creation statuses — business decision 2026-10-05). Payments need
// CONFIRMED/RECEIVED/CLOSED and returns RECEIVED/CLOSED, so any later status
// is reached via the status endpoint (setPurchaseStatusViaApi). The default here stays DRAFT on purpose:
// tests that don't care get a purchase with no money actions available.
async function createPurchaseViaApi(request: APIRequestContext, totalPrice = 1_000_000, status: PurchaseStatusValue = "DRAFT"): Promise<number> {
  const md = await masterData(request);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const supplier = suppliers.find((s) => s.status === "active");
  if (!supplier || types.length === 0) throw new Error("An active supplier and a purchase type must exist.");
  const data = {
    purchaseDate: localTodayIso(),
    purchaseTypeId: types[0].id,
    sourceType: "OPERATIONAL",
    requesterDepartmentId: md.departmentId,
    buyerEmployeeId: md.employeeId,
    supplierId: supplier.id,
    note: QA_NOTE,
    items: [{ name: `شیر خام QA ${uniqueSuffix()}`, quantity: 10, unitId: md.unitId, unitPrice: totalPrice / 10, totalPrice }],
  };
  const createStatus = status === "DRAFT" ? "DRAFT" : "CONFIRMED";
  const response = await request.post(`${BACKEND}/purchases`, { data: { ...data, status: createStatus } });
  if (!response.ok()) throw new Error(`Failed to create purchase: ${response.status()} ${await response.text()}`);
  const created = (await response.json()) as { id: number; updatedAt: string; status: string };
  expect(created.status).toBe(createStatus);
  if (status !== createStatus) await setPurchaseStatusViaApi(request, created.id, status, created.updatedAt);
  return created.id;
}

// From CONFIRMED, the legal path to each later status through the
// status-only endpoint (PATCH /purchases/:id/status — one step at a time;
// PATCH /purchases/:id refuses any status change since 2026-10-06).
const STATUS_PATH_FROM_CONFIRMED: Partial<Record<PurchaseStatusValue, PurchaseStatusValue[]>> = {
  RECEIVED: ["RECEIVED"],
  CLOSED: ["RECEIVED", "CLOSED"],
  CANCELLED: ["CANCELLED"],
};

async function setPurchaseStatusViaApi(request: APIRequestContext, id: number, status: PurchaseStatusValue, updatedAt: string) {
  const path = STATUS_PATH_FROM_CONFIRMED[status];
  if (!path) throw new Error(`No status path from CONFIRMED to ${status}`);
  let version = updatedAt;
  for (const step of path) {
    const patched = await request.patch(`${BACKEND}/purchases/${id}/status`, { data: { status: step, updatedAt: version } });
    if (!patched.ok()) throw new Error(`Failed to set purchase status ${step}: ${patched.status()} ${await patched.text()}`);
    version = ((await patched.json()) as { updatedAt: string }).updatedAt;
  }
}

// Local calendar "today" as YYYY-MM-DD — same day the browser's Jalali
// picker calls "today" (toISOString() would be the UTC day, which can differ).
function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Today's Jalali date as JalaliDateInput option values. Payments/returns
// can't be dated before the purchase (business rule 2026-10-05), and the
// fixtures create purchases dated today.
function jalaliToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value.replace(/\D/g, ""));
  return { year: get("year"), month: get("month"), day: get("day") };
}

async function selectJalaliToday(scope: Page | Locator, idPrefix: string) {
  const today = jalaliToday();
  await scope.locator(`#${idPrefix}-year`).selectOption(String(today.year));
  await scope.locator(`#${idPrefix}-month`).selectOption(String(today.month));
  await scope.locator(`#${idPrefix}-day`).selectOption(String(today.day));
}

async function getRequest(request: APIRequestContext, id: number) {
  const response = await request.get(`${BACKEND}/purchase-requests/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    status: string;
    priority: string;
    note: string | null;
    items: { id: number; name: string; quantity: string; purchasedQuantity: number; remainingQuantity: number }[];
  };
}

// ---- page helpers -----------------------------------------------------------

function requestHeader(page: Page) {
  return page.getByRole("heading", { level: 1 }).locator("xpath=../..");
}

function requestedItemRow(page: Page, itemName: string) {
  return page.locator("tbody tr").filter({ hasText: itemName });
}

async function openRequestDetail(page: Page, requestId: number, requestNumber: string) {
  await page.goto(`/purchase-requests/${requestId}`);
  await expect(page.getByRole("heading", { name: `درخواست خرید ${requestNumber}` })).toBeVisible();
}

async function expectItemQuantities(page: Page, itemName: string, purchased: number, remaining: number) {
  const cells = requestedItemRow(page, itemName).locator("td");
  await expect(cells.nth(2)).toHaveText(fa(purchased));
  await expect(cells.nth(3)).toHaveText(fa(remaining));
}

function purchaseItemRow(page: Page, index: number) {
  return page.locator("form#purchase-form table tbody tr").nth(index);
}

async function selectFirstRealOption(select: Locator) {
  await expect(select.locator("option").nth(1)).toBeAttached();
  const value = await select.locator("option").nth(1).getAttribute("value");
  if (!value) throw new Error("No option available.");
  await select.selectOption(value);
}

// Fills everything a request-prefilled purchase form leaves to the user.
async function fillPurchaseHeader(page: Page, md: MasterData) {
  await selectFirstRealOption(page.locator("#purchase-type"));
  await selectFirstRealOption(page.locator("#purchase-supplier"));
  await page.locator("#purchase-department").selectOption(String(md.departmentId));
  await page.locator("#purchase-buyer").selectOption(String(md.employeeId));
  await page.locator("#purchase-note").fill(QA_NOTE);
}

async function submitNewPurchase(page: Page): Promise<number> {
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/purchases\/\d+$/);
  return Number(new URL(page.url()).pathname.split("/").pop());
}

// The custom Base UI Select used for "درخواست خرید مرتبط".
async function pickPurchaseRequest(page: Page, requestNumber: string) {
  await page.locator("#purchase-request").click();
  await page.getByRole("option", { name: new RegExp(requestNumber) }).click();
}

// A leftover full-viewport layer is exactly what the two earlier picker bugs
// produced — assert none is mounted and the trigger is really hit-testable.
async function expectNoBlockingOverlay(page: Page) {
  await expect(page.locator(".fixed.inset-0")).toHaveCount(0);
  const hitsTrigger = await page.locator("#purchase-request").evaluate((trigger) => {
    const rect = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && trigger.contains(hit);
  });
  expect(hitsTrigger).toBe(true);
}

// ---- 1. the critical regression ---------------------------------------------

test("1) request lifecycle: create → تایید → partial purchase → unrelated edit keeps fulfillment → buy remainder → COMPLETED survives another edit", async ({ page, request }) => {
  test.setTimeout(120_000);
  const md = await masterData(request);
  const suffix = uniqueSuffix();
  const itemA = { name: `شیر خام QA ${suffix}`, quantity: 100 };
  const itemB = { name: `بطری پلاستیکی ۱ لیتری پنج‌لایه QA ${suffix}`, quantity: 500 };

  // Create the request through the real form (date defaults to today).
  await page.goto("/purchase-requests/new");
  await expect(page.getByRole("heading", { name: "ثبت درخواست خرید جدید" })).toBeVisible();
  await expect(page.locator("#request-date-year")).not.toHaveValue("");
  await page.locator("#request-purchase-type").selectOption(String(md.purchaseTypeId));
  await page.locator("#request-department").selectOption(String(md.departmentId));
  await page.locator("#request-note").fill(QA_NOTE);
  const rows = page.locator("form#purchase-request-form table tbody tr");
  await rows.nth(0).getByLabel("نام یا شرح قلم").fill(itemA.name);
  await rows.nth(0).getByLabel("مقدار", { exact: true }).fill(String(itemA.quantity));
  await rows.nth(0).getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await page.getByRole("button", { name: "افزودن قلم" }).click();
  await rows.nth(1).getByLabel("نام یا شرح قلم").fill(itemB.name);
  await rows.nth(1).getByLabel("مقدار", { exact: true }).fill(String(itemB.quantity));
  await rows.nth(1).getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await page.locator('button[form="purchase-request-form"]').click();
  await page.waitForURL(/\/purchase-requests\/\d+$/);
  const requestId = Number(new URL(page.url()).pathname.split("/").pop());
  const requestNumber = (await page.getByRole("heading", { level: 1 }).innerText()).replace("درخواست خرید", "").trim();

  // DRAFT: ثبت خرید visible but disabled with an explanation.
  await expect(requestHeader(page)).toContainText("پیش‌نویس");
  const buyButton = page.getByRole("main").getByRole("button", { name: "ثبت خرید", exact: true });
  await expect(buyButton).toBeDisabled();
  await expect(buyButton).toHaveAttribute("title", "ابتدا درخواست را تأیید کنید");

  // تایید — status and the buy action update without a page reload.
  await page.getByRole("button", { name: "تایید", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "درخواست خرید تأیید شد." })).toBeVisible();
  await expect(requestHeader(page)).toContainText("تأییدشده");
  await expect(buyButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "تایید", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "رد", exact: true })).toHaveCount(0);

  // Partial purchase of item A only (40 of 100).
  await requestedItemRow(page, itemA.name).getByRole("button", { name: "ایجاد خرید" }).click();
  await page.waitForURL(/\/purchases\/new\?prefill=/);
  await expect(page.locator("#purchase-request")).toContainText(requestNumber);
  await expect(page.locator("form#purchase-form table tbody tr")).toHaveCount(1);
  await expect(purchaseItemRow(page, 0).getByLabel("نام یا شرح قلم")).toHaveValue(itemA.name);
  await expect(purchaseItemRow(page, 0).getByLabel("مقدار", { exact: true })).toHaveValue("100");
  await purchaseItemRow(page, 0).getByLabel("مقدار", { exact: true }).fill("40");
  await purchaseItemRow(page, 0).getByLabel("قیمت واحد").fill("250000");
  await expect(purchaseItemRow(page, 0).getByLabel("قیمت کل")).toHaveValue("10000000");
  await fillPurchaseHeader(page, md);
  await submitNewPurchase(page);

  await openRequestDetail(page, requestId, requestNumber);
  await expect(requestHeader(page)).toContainText("خرید جزئی");
  await expectItemQuantities(page, itemA.name, 40, 60);
  await expectItemQuantities(page, itemB.name, 0, 500);

  // Unrelated edit through the edit form: priority + note. The system-only
  // status must still be offered as the current value (and only that one).
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ویرایش درخواست خرید" })).toBeVisible();
  const statusSelect = page.locator("#request-status");
  await expect(statusSelect).toHaveValue("PARTIALLY_PURCHASED");
  await expect(statusSelect.locator('option[value="COMPLETED"]')).toHaveCount(0);
  await page.locator("#request-priority").selectOption("URGENT");
  await page.locator("#request-note").fill(`${QA_NOTE} — ویرایش اول`);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await page.waitForURL(new RegExp(`/purchase-requests/${requestId}$`));

  // THE regression: fulfillment links and status survive the edit.
  await expect(requestHeader(page)).toContainText("فوری");
  await expect(requestHeader(page)).toContainText("خرید جزئی");
  await expectItemQuantities(page, itemA.name, 40, 60);
  await expectItemQuantities(page, itemB.name, 0, 500);
  const afterEdit = await getRequest(request, requestId);
  expect(afterEdit.status).toBe("PARTIALLY_PURCHASED");
  expect(afterEdit.items.find((i) => i.name === itemA.name)?.purchasedQuantity).toBe(40);

  // Buy the remainder through the header "ثبت خرید" action.
  await buyButton.click();
  await page.waitForURL(/\/purchases\/new\?prefill=/);
  await expect(page.locator("form#purchase-form table tbody tr")).toHaveCount(2);
  await expect(purchaseItemRow(page, 0).getByLabel("مقدار", { exact: true })).toHaveValue("60");
  await expect(purchaseItemRow(page, 1).getByLabel("مقدار", { exact: true })).toHaveValue("500");
  await purchaseItemRow(page, 0).getByLabel("قیمت کل").fill("15000000");
  await purchaseItemRow(page, 1).getByLabel("قیمت کل").fill("4000000");
  await fillPurchaseHeader(page, md);
  await submitNewPurchase(page);

  await openRequestDetail(page, requestId, requestNumber);
  await expect(requestHeader(page)).toContainText("تکمیل‌شده");
  await expectItemQuantities(page, itemA.name, 100, 0);
  await expectItemQuantities(page, itemB.name, 500, 0);
  await expect(buyButton).toBeDisabled();
  await expect(page.locator("table").last().getByRole("link", { name: /^PUR-\d+$/ })).toHaveCount(2);

  // A second unrelated edit on the COMPLETED request.
  await page.goto(`/purchase-requests/${requestId}/edit`);
  await expect(page.locator("#request-status")).toHaveValue("COMPLETED");
  await page.locator("#request-note").fill(`${QA_NOTE} — ویرایش دوم`);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await page.waitForURL(new RegExp(`/purchase-requests/${requestId}$`));
  await expect(requestHeader(page)).toContainText("تکمیل‌شده");
  await expectItemQuantities(page, itemA.name, 100, 0);
  await expectItemQuantities(page, itemB.name, 500, 0);
});

// ---- 2. رد (reject) ----------------------------------------------------------

test("2) رد: dismissing the confirm changes nothing; accepting rejects and hides every action", async ({ page, request }) => {
  const item = { name: `کره حیوانی QA ${uniqueSuffix()}`, quantity: 20 };
  const pr = await createRequestViaApi(request, [item], { approve: false });
  await openRequestDetail(page, pr.id, pr.requestNumber);

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "رد", exact: true }).click();
  await expect(requestHeader(page)).toContainText("پیش‌نویس");
  expect((await getRequest(request, pr.id)).status).toBe("DRAFT");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "رد", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "درخواست خرید رد شد." })).toBeVisible();
  await expect(requestHeader(page)).toContainText("ردشده");
  await expect(page.getByRole("button", { name: "تایید", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "رد", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "ثبت خرید", exact: true })).toBeDisabled();
  const after = await getRequest(request, pr.id);
  expect(after.status).toBe("REJECTED");
  expect(after.items).toHaveLength(1);
  expect(after.items[0].name).toBe(item.name);
});

// ---- 3. picker ---------------------------------------------------------------

test("3) picker: pick A fills items; pick B → inline banner → replace (not append); انصراف keeps items; no overlay left, across repeated cycles", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const a = await createRequestViaApi(request, [{ name: `ماست پرچرب QA-A ${suffix}`, quantity: 30 }]);
  const b = await createRequestViaApi(request, [
    { name: `پنیر لیقوان QA-B1 ${suffix}`, quantity: 12 },
    { name: `دوغ گازدار QA-B2 ${suffix}`, quantity: 48 },
  ]);

  await page.goto("/purchases/new");
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
  const rows = page.locator("form#purchase-form table tbody tr");

  await pickPurchaseRequest(page, a.requestNumber);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).getByLabel("نام یا شرح قلم")).toHaveValue(`ماست پرچرب QA-A ${suffix}`);
  await expectNoBlockingOverlay(page);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const [target, otherNames] =
      cycle % 2 === 0
        ? [b, [`پنیر لیقوان QA-B1 ${suffix}`, `دوغ گازدار QA-B2 ${suffix}`]]
        : [a, [`ماست پرچرب QA-A ${suffix}`]];
    await pickPurchaseRequest(page, target.requestNumber);
    const banner = page.getByText("اقلام فعلی فرم با اقلام این درخواست خرید جایگزین می‌شود. ادامه می‌دهید؟");
    await expect(banner).toBeVisible();
    // Picker is locked while the banner is up.
    await expect(page.locator("#purchase-request")).toBeDisabled();
    await page.getByRole("button", { name: "جایگزین کن" }).click();
    await expect(banner).toHaveCount(0);
    await expect(rows).toHaveCount(otherNames.length);
    for (const [index, name] of otherNames.entries()) {
      await expect(rows.nth(index).getByLabel("نام یا شرح قلم")).toHaveValue(name);
    }
    await expect(page.locator("#purchase-request")).toContainText(target.requestNumber);
    await expectNoBlockingOverlay(page);
  }

  // After 3 cycles (B, A, B) B is selected. انصراف on a pick of A: items
  // and the selected request stay as they were. (Scoped to the banner — the
  // sticky footer has its own "انصراف" that navigates back.)
  await pickPurchaseRequest(page, a.requestNumber);
  const banner = page.getByText("اقلام فعلی فرم با اقلام این درخواست خرید جایگزین می‌شود. ادامه می‌دهید؟").locator("..");
  await banner.getByRole("button", { name: "انصراف" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByLabel("نام یا شرح قلم")).toHaveValue(`پنیر لیقوان QA-B1 ${suffix}`);
  await expect(page.locator("#purchase-request")).toContainText(b.requestNumber);
  await expectNoBlockingOverlay(page);
});

// BUG: clearing the picker back to "بدون درخواست خرید" only clears
// purchaseRequestId (PurchaseForm.handlePurchaseRequestChange); the item rows
// keep their hidden purchaseRequestItemId. The backend then refuses the save
// with "برای انتخاب قلم درخواست خرید، ابتدا درخواست خرید مرتبط را انتخاب
// کنید" — the opposite of what the user just chose — and the only way out
// is deleting and retyping every row.
test("4) clearing the picker to 'بدون درخواست خرید' must not leave hidden request-item links on the lines", async ({ page, request }) => {
  const md = await masterData(request);
  const suffix = uniqueSuffix();
  const pr = await createRequestViaApi(request, [{ name: `خامه صبحانه QA ${suffix}`, quantity: 10 }]);

  await page.goto("/purchases/new");
  await pickPurchaseRequest(page, pr.requestNumber);
  await expect(purchaseItemRow(page, 0).getByLabel("نام یا شرح قلم")).toHaveValue(`خامه صبحانه QA ${suffix}`);
  await page.locator("#purchase-request").click();
  await page.getByRole("option", { name: "بدون درخواست خرید" }).click();
  await expect(page.locator("#purchase-request")).toContainText("بدون درخواست خرید");

  await purchaseItemRow(page, 0).getByLabel("قیمت کل").fill("900000");
  await fillPurchaseHeader(page, md);
  const purchaseId = await submitNewPurchase(page);
  await expect(page.getByText("بدون درخواست خرید (ثبت مستقیم)")).toBeVisible();

  const purchase = (await (await request.get(`${BACKEND}/purchases/${purchaseId}`)).json()) as {
    purchaseRequest: unknown;
    items: { purchaseRequestItemId: number | null }[];
  };
  expect(purchase.purchaseRequest).toBeNull();
  // A purchase "with no request" must not secretly fulfill one.
  expect(purchase.items[0].purchaseRequestItemId).toBeNull();
  const after = await getRequest(request, pr.id);
  expect(after.items[0].purchasedQuantity).toBe(0);
  expect(after.status).toBe("APPROVED");
});

// BUG: on a COMPLETED (or REJECTED) request the disabled "ثبت خرید" button's
// tooltip still says "ابتدا درخواست را تأیید کنید" — the status check runs
// before the nothing-left-to-buy check (purchase-requests/[id]/page.tsx).
test("5) a fully-purchased request explains why ثبت خرید is disabled correctly", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `دوغ محلی QA ${uniqueSuffix()}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 5 }]);
  const detail = await getRequest(request, pr.id);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const created = await request.post(`${BACKEND}/purchases`, {
    data: {
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseTypeId: types[0].id,
      sourceType: "OPERATIONAL",
      requesterDepartmentId: md.departmentId,
      buyerEmployeeId: md.employeeId,
      supplierId: suppliers.find((s) => s.status === "active")!.id,
      purchaseRequestId: pr.id,
      note: QA_NOTE,
      items: [{ name, quantity: 5, unitId: md.unitId, totalPrice: 50000, purchaseRequestItemId: detail.items[0].id }],
    },
  });
  expect(created.ok()).toBeTruthy();
  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("تکمیل‌شده");
  await expect(page.getByRole("main").getByRole("button", { name: "ثبت خرید", exact: true })).toHaveAttribute(
    "title",
    "همه اقلام این درخواست خریداری شده است",
  );
});

// ---- 6. editing request lines that already have purchases -------------------

test("6) editing a partially-purchased request: adding a line and renaming a purchased line keeps the purchased quantity", async ({ page, request }) => {
  const md = await masterData(request);
  const suffix = uniqueSuffix();
  const name = `پنیر سفید QA ${suffix}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 50 }]);
  const detail = await getRequest(request, pr.id);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const created = await request.post(`${BACKEND}/purchases`, {
    data: {
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseTypeId: types[0].id,
      sourceType: "OPERATIONAL",
      requesterDepartmentId: md.departmentId,
      buyerEmployeeId: md.employeeId,
      supplierId: suppliers.find((s) => s.status === "active")!.id,
      purchaseRequestId: pr.id,
      note: QA_NOTE,
      items: [{ name, quantity: 20, unitId: md.unitId, totalPrice: 200000, purchaseRequestItemId: detail.items[0].id }],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto(`/purchase-requests/${pr.id}/edit`);
  await expect(page.getByRole("heading", { name: "ویرایش درخواست خرید" })).toBeVisible();
  const rows = page.locator("form#purchase-request-form table tbody tr");
  await rows.nth(0).getByLabel("نام یا شرح قلم").fill(`${name} (ویرایش‌شده)`);
  await page.getByRole("button", { name: "افزودن قلم" }).click();
  await rows.nth(1).getByLabel("نام یا شرح قلم").fill(`نمک یددار QA ${suffix}`);
  await rows.nth(1).getByLabel("مقدار", { exact: true }).fill("3");
  await rows.nth(1).getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await page.waitForURL(new RegExp(`/purchase-requests/${pr.id}$`));

  await expect(requestHeader(page)).toContainText("خرید جزئی");
  await expectItemQuantities(page, `${name} (ویرایش‌شده)`, 20, 30);
  await expectItemQuantities(page, `نمک یددار QA ${suffix}`, 0, 3);
});

test("6b) removing a request line that already has purchases is refused with a clear Persian message, and nothing is lost", async ({ page, request }) => {
  const md = await masterData(request);
  const suffix = uniqueSuffix();
  const kept = `شیر پاستوریزه QA ${suffix}`;
  const bought = `شیر کم‌چرب QA ${suffix}`;
  const pr = await createRequestViaApi(request, [{ name: kept, quantity: 10 }, { name: bought, quantity: 10 }]);
  const detail = await getRequest(request, pr.id);
  const boughtItem = detail.items.find((i) => i.name === bought)!;
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const created = await request.post(`${BACKEND}/purchases`, {
    data: {
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseTypeId: types[0].id,
      sourceType: "OPERATIONAL",
      requesterDepartmentId: md.departmentId,
      buyerEmployeeId: md.employeeId,
      supplierId: suppliers.find((s) => s.status === "active")!.id,
      purchaseRequestId: pr.id,
      note: QA_NOTE,
      items: [{ name: bought, quantity: 4, unitId: md.unitId, totalPrice: 40000, purchaseRequestItemId: boughtItem.id }],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto(`/purchase-requests/${pr.id}/edit`);
  const rows = page.locator("form#purchase-request-form table tbody tr");
  await rows.filter({ has: page.locator(`input[value="${bought}"]`) }).getByLabel("حذف قلم").click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("alert").filter({ hasText: `برای قلم «${bought}» خرید ثبت شده است و نمی‌توان آن را از درخواست حذف کرد` })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${pr.id}/edit$`));
  const after = await getRequest(request, pr.id);
  const boughtAfter = after.items.find((i) => i.id === boughtItem.id);
  expect(boughtAfter, "the purchased line must not disappear from the request").toBeTruthy();
  expect(boughtAfter!.purchasedQuantity).toBe(4);
});

// ---- 7. payments ---------------------------------------------------------------

async function addPayment(page: Page, amount: string, status: "PENDING" | "COMPLETED" | null) {
  await page.getByRole("button", { name: "افزودن پرداخت" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Today — a payment can't be dated before the purchase (created today).
  await selectJalaliToday(dialog, "payment-date");
  await dialog.locator("#payment-amount").fill(amount);
  if (status) await dialog.locator("#payment-status").selectOption(status);
  await dialog.getByRole("button", { name: "ثبت پرداخت" }).click();
  await expect(page.getByRole("status").filter({ hasText: "پرداخت با موفقیت ثبت شد." }).last()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

function paymentSummaryCell(page: Page, label: string) {
  return page.locator("p", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::p[1]");
}

test("7) payments: partial → PAID → delete back to partial, badge and amounts update live without a reload", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 1_000_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=../../..");
  await expect(header).toContainText("پرداخت‌نشده");

  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await addPayment(page, "400000", "COMPLETED");
  await expect(header).toContainText("پرداخت جزئی");
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(400000)} ریال`);
  await expect(paymentSummaryCell(page, "مبلغ باقی‌مانده")).toHaveText(`${fa(600000)} ریال`);

  await addPayment(page, "600000", "COMPLETED");
  await expect(header).toContainText("پرداخت‌شده");
  await expect(paymentSummaryCell(page, "مبلغ باقی‌مانده")).toHaveText(`${fa(0)} ریال`);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("tbody tr").filter({ hasText: fa(600000) }).getByRole("button", { name: "حذف" }).click();
  await expect(page.getByRole("status").filter({ hasText: "پرداخت حذف شد." })).toBeVisible();
  await expect(header).toContainText("پرداخت جزئی");
  expect(navigations, "no full page navigation should be needed").toBe(0);
});

// Business decision 2026-10-05 (#7): the add-payment dialog defaults to
// "تکمیل‌شده" (COMPLETED) — only COMPLETED payments count toward paidAmount,
// so recording a cash payment with the defaults now pays the purchase.
test("7b) #7 a payment saved with the dialog's default status (COMPLETED) counts toward the paid amount", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "افزودن پرداخت" }).click();
  await expect(page.getByRole("dialog").locator("#payment-status")).toHaveValue("COMPLETED");
  await page.getByRole("dialog").getByRole("button", { name: "انصراف" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addPayment(page, "500000", null);
  await expect(page.locator("tbody tr").filter({ hasText: "نقدی" })).toContainText("تکمیل‌شده");
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(500000)} ریال`);
  await expect(page.getByRole("heading", { level: 1 }).locator("xpath=../../..")).toContainText("پرداخت‌شده");
});

test("7c) payment dialog rejects empty, zero, negative, decimal and Persian-digit amounts with Persian messages (dialog stays open)", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "افزودن پرداخت" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ثبت پرداخت" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "تاریخ و مبلغ پرداخت الزامی است." })).toBeVisible();
  await selectJalaliToday(dialog, "payment-date");
  for (const bad of ["0", "-5000", "1500.5", "abc"]) {
    await dialog.locator("#payment-amount").fill(bad);
    await dialog.getByRole("button", { name: "ثبت پرداخت" }).click();
    await expect(page.getByRole("alert").last()).toBeVisible();
    await expect(page.getByRole("alert").last()).not.toContainText(/[A-Za-z]{4,}/);
    await expect(dialog).toBeVisible();
  }
  const purchase = (await (await request.get(`${BACKEND}/purchases/${purchaseId}`)).json()) as { payments: unknown[] };
  expect(purchase.payments).toHaveLength(0);
});

// ---- 8. documents ------------------------------------------------------------

test("8) a document uploaded on the detail page opens for the logged-in user and is refused without a session", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request);
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "افزودن سند" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#document-number").fill(`INV-QA-${uniqueSuffix()}`);
  await dialog.locator("#document-date-year").selectOption({ index: 1 });
  await dialog.locator("#document-date-month").selectOption({ index: 1 });
  await dialog.locator("#document-date-day").selectOption({ index: 1 });
  await dialog.locator("#document-file").setInputFiles({ name: "فاکتور-شیر.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n%%EOF\n") });
  await dialog.getByRole("button", { name: "ثبت سند" }).click();
  await expect(page.getByRole("status").filter({ hasText: "سند با موفقیت اضافه شد." })).toBeVisible();

  const link = page.getByRole("link", { name: "مشاهده" });
  await expect(link).toHaveCount(1);
  const href = (await link.getAttribute("href"))!;
  const withSession = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "include" });
    return { status: res.status, head: (await res.text()).slice(0, 5) };
  }, href);
  expect(withSession).toEqual({ status: 200, head: "%PDF-" });
  const withoutSession = await page.evaluate(async (url) => (await fetch(url, { credentials: "omit" })).status, href);
  expect([401, 403]).toContain(withoutSession);
});

// BUG: on the detail page the document metadata row is created first and the
// file uploaded second; if the upload is refused (e.g. content isn't really a
// PDF) the metadata row is left behind with no file, and every retry adds
// another one. PurchaseForm's create-time upload already cleans this up.
test("8b) a refused document upload on the detail page leaves no orphan, file-less document row", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request);
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "افزودن سند" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#document-date-year").selectOption({ index: 1 });
  await dialog.locator("#document-date-month").selectOption({ index: 1 });
  await dialog.locator("#document-date-day").selectOption({ index: 1 });
  await dialog.locator("#document-file").setInputFiles({ name: "not-really.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is not a pdf") });
  await dialog.getByRole("button", { name: "ثبت سند" }).click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  const purchase = (await (await request.get(`${BACKEND}/purchases/${purchaseId}`)).json()) as { documents: unknown[] };
  expect(purchase.documents).toHaveLength(0);
});

// ---- 9. returns ---------------------------------------------------------------

test("9) a return to vendor is listed but does not change the purchase's total / paid / payment status", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 1_000_000, "RECEIVED");
  await page.goto(`/purchases/${purchaseId}`);
  await addPayment(page, "1000000", "COMPLETED");
  const header = page.getByRole("heading", { level: 1 }).locator("xpath=../../..");
  await expect(header).toContainText("پرداخت‌شده");

  await page.getByRole("button", { name: "ثبت برگشت" }).click();
  const dialog = page.getByRole("dialog");
  await selectJalaliToday(dialog, "return-date");
  await dialog.locator("#return-reason").fill("ترش‌شدگی شیر در زمان تحویل");
  await selectFirstRealOption(dialog.getByLabel("قلم خرید"));
  await dialog.getByLabel("مقدار برگشتی").fill("2");
  // Suggested from quantity × unit price (100,000).
  await expect(dialog.getByLabel("مبلغ اعتبار")).toHaveValue("200000");
  await dialog.getByRole("button", { name: "ثبت برگشت" }).click();
  await expect(page.getByRole("status").filter({ hasText: "برگشت به تأمین‌کننده با موفقیت ثبت شد." })).toBeVisible();

  await expect(page.getByText("جمع اعتبار برگشت‌ها")).toBeVisible();
  await expect(paymentSummaryCell(page, "مبلغ کل")).toHaveText(`${fa(1000000)} ریال`);
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(1000000)} ریال`);
  await expect(header).toContainText("پرداخت‌شده");
  const purchase = (await (await request.get(`${BACKEND}/purchases/${purchaseId}`)).json()) as { totalAmount: string; paidAmount: string; paymentStatus: string };
  expect(purchase).toMatchObject({ totalAmount: "1000000", paidAmount: "1000000", paymentStatus: "PAID" });
});

test("9b) returning more than was bought is refused and the dialog stays open", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 1_000_000, "RECEIVED");
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "ثبت برگشت" }).click();
  const dialog = page.getByRole("dialog");
  await selectJalaliToday(dialog, "return-date");
  await dialog.locator("#return-reason").fill("آزمون مقدار بیش از حد");
  await selectFirstRealOption(dialog.getByLabel("قلم خرید"));
  await dialog.getByLabel("مقدار برگشتی").fill("11");
  await dialog.getByRole("button", { name: "ثبت برگشت" }).click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  await expect(dialog).toBeVisible();
  const returns = (await (await request.get(`${BACKEND}/purchases/${purchaseId}/returns`)).json()) as unknown[];
  expect(returns).toHaveLength(0);
});

// ---- 10. double submit ---------------------------------------------------------

test("10) double-clicking 'ثبت خرید' creates exactly one purchase", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `نگهدارنده مجاز خوراکی QA ${uniqueSuffix()}`;
  await page.goto("/purchases/new");
  await fillPurchaseHeader(page, md);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(name);
  await row.getByLabel("مقدار", { exact: true }).fill("3");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("قیمت کل").fill("750000");
  await page.locator('button[form="purchase-form"]').dblclick();
  await page.waitForURL(/\/purchases\/\d+$/);
  await page.waitForTimeout(1500);
  const all = (await (await request.get(`${BACKEND}/purchases`)).json()) as Array<{ items: { name: string }[] }>;
  expect(all.filter((p) => p.items[0]?.name === name)).toHaveLength(1);
});

test("10b) double-clicking 'ثبت درخواست خرید' creates exactly one request", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `کارتن بسته‌بندی QA ${uniqueSuffix()}`;
  await page.goto("/purchase-requests/new");
  await page.locator("#request-purchase-type").selectOption(String(md.purchaseTypeId));
  await page.locator("#request-department").selectOption(String(md.departmentId));
  await page.locator("#request-note").fill(QA_NOTE);
  const row = page.locator("form#purchase-request-form table tbody tr").first();
  await row.getByLabel("نام یا شرح قلم").fill(name);
  await row.getByLabel("مقدار", { exact: true }).fill("7");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await page.locator('button[form="purchase-request-form"]').dblclick();
  await page.waitForURL(/\/purchase-requests\/\d+$/);
  await page.waitForTimeout(1500);
  const all = (await (await request.get(`${BACKEND}/purchase-requests`)).json()) as Array<{ items: { name: string }[] }>;
  expect(all.filter((r) => r.items[0]?.name === name)).toHaveLength(1);
});

test("10c) double-clicking تایید sends one approval and leaves the request APPROVED", async ({ page, request }) => {
  const name = `شیر خشک QA ${uniqueSuffix()}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 9 }], { approve: false });
  await openRequestDetail(page, pr.id, pr.requestNumber);
  let patches = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes(`/purchase-requests/${pr.id}`)) patches += 1;
  });
  await page.getByRole("button", { name: "تایید", exact: true }).dblclick();
  await expect(requestHeader(page)).toContainText("تأییدشده");
  expect(patches).toBe(1);
});

// ---- 11. Persian digits ---------------------------------------------------------

// BUG: quantity / price inputs pass the raw text to Number(); a user typing on
// a Persian keyboard ("۴۰") gets NaN — the auto-total stays empty and saving
// sends null, which the backend rejects as a missing/invalid number.
test("11) quantities and prices typed with Persian digits are accepted", async ({ page, request }) => {
  const md = await masterData(request);
  await page.goto("/purchases/new");
  await fillPurchaseHeader(page, md);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(`ماست کم‌چرب QA ${uniqueSuffix()}`);
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("مقدار", { exact: true }).fill("۴۰");
  await row.getByLabel("قیمت واحد").fill("۲۵۰۰۰");
  await expect(row.getByLabel("قیمت کل")).toHaveValue(/^(1000000|۱۰۰۰۰۰۰)$/);
  await submitNewPurchase(page);
});

// ---- 12. extreme input ----------------------------------------------------------

test("12) long Persian text, emoji and bidi-control characters round-trip without breaking the detail layout", async ({ page, request }) => {
  const md = await masterData(request);
  // PurchaseItem.name is capped at 150 characters by the backend.
  const longName = `${"بطری پلاستیکی ۱ لیتری پنج‌لایه با درب پیچی و برچسب حرارتی ".repeat(2)}QA ${uniqueSuffix()}`.slice(0, 150);
  const trickyNote = `${QA_NOTE} 🥛🧀 ‮گزارش‬ ‏تست`;
  await page.goto("/purchases/new");
  await fillPurchaseHeader(page, md);
  await page.locator("#purchase-note").fill(trickyNote);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(longName);
  await row.getByLabel("مقدار", { exact: true }).fill("1");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("قیمت کل").fill("999999999999999");
  const id = await submitNewPurchase(page);

  await expect(page.locator("tbody tr").first()).toContainText(longName.trim());
  await expect(page.getByText(`${fa(999999999999999)} ریال`).first()).toBeVisible();
  // The page must not scroll sideways because of one long item name.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const saved = (await (await request.get(`${BACKEND}/purchases/${id}`)).json()) as { note: string; totalAmount: string };
  expect(saved.note).toBe(trickyNote.trim());
  expect(saved.totalAmount).toBe("999999999999999");
});

test("12b) an amount above the Rial column limit is refused with a Persian message, not silently rounded", async ({ page, request }) => {
  const md = await masterData(request);
  await page.goto("/purchases/new");
  await fillPurchaseHeader(page, md);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(`QA بیش از حد ${uniqueSuffix()}`);
  await row.getByLabel("مقدار", { exact: true }).fill("1");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("قیمت کل").fill("12345678901234567");
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("alert").filter({ hasText: "بیش از حد مجاز" })).toBeVisible();
  await expect(page).toHaveURL(/\/purchases\/new/);
});

// ---- 13. list pages ------------------------------------------------------------

// BUG: one purchase with an out-of-range date (PUR-000138, 9999-12-31, created
// through the API — the backend accepts any year) makes formatJalali() throw
// and takes down /purchases, its detail page and the /main dashboard for
// every user.
test("13) the purchases list and dashboard render even if some record has an extreme date", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/purchases");
  await expect(page.getByRole("heading", { name: "خریدها" })).toBeVisible({ timeout: 10_000 });
  await page.goto("/main");
  await page.waitForTimeout(3000);
  expect(errors).toEqual([]);
});

test("13b) purchase requests list shows the colour legend and status-tinted cells", async ({ page }) => {
  await page.goto("/purchase-requests");
  await expect(page.getByRole("heading", { name: "درخواست‌های خرید" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  for (const label of ["پیش‌نویس", "تأییدشده", "خرید جزئی", "تکمیل‌شده", "ردشده"]) {
    await expect(page.getByText(label, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
});

// ---- 14. concurrent edit in two tabs -------------------------------------------

// Business decision 2026-10-05 (#12): optimistic locking — the second save
// is refused with a clear conflict message and must reload first; tab 1's
// change is never silently overwritten.
test("14) #12 two tabs editing the same request: the second save is refused (no lost update) and must reload", async ({ page, context, request }) => {
  const pr = await createRequestViaApi(request, [{ name: `آب‌پنیر QA ${uniqueSuffix()}`, quantity: 15 }]);
  const tab2 = await context.newPage();
  await page.goto(`/purchase-requests/${pr.id}/edit`);
  await tab2.goto(`/purchase-requests/${pr.id}/edit`);
  await expect(page.locator("#request-note")).toHaveValue(QA_NOTE);
  await expect(tab2.locator("#request-note")).toHaveValue(QA_NOTE);

  await page.locator("#request-note").fill(`${QA_NOTE} — تب اول`);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await page.waitForURL(new RegExp(`/purchase-requests/${pr.id}$`));

  await tab2.locator("#request-priority").selectOption("HIGH");
  await tab2.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(tab2.getByRole("alert").filter({ hasText: "توسط کاربر دیگری تغییر کرده است" }).first()).toBeVisible();
  await expect(tab2.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
  await expect(tab2).toHaveURL(new RegExp(`/purchase-requests/${pr.id}/edit$`));

  const after = await getRequest(request, pr.id);
  expect(after.note).toBe(`${QA_NOTE} — تب اول`);
  expect(after.priority).toBe("NORMAL");

  // After a reload the form carries the new version and saves fine.
  await tab2.getByRole("button", { name: "بازخوانی صفحه" }).click();
  await expect(tab2.locator("#request-note")).toHaveValue(`${QA_NOTE} — تب اول`);
  await tab2.locator("#request-priority").selectOption("HIGH");
  await tab2.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await tab2.waitForURL(new RegExp(`/purchase-requests/${pr.id}$`));
  const final = await getRequest(request, pr.id);
  expect(final).toMatchObject({ priority: "HIGH", note: `${QA_NOTE} — تب اول` });
  await tab2.close();
});

// ---- 15. permission-based UI ---------------------------------------------------

// A purchases.view-only account (role VIEWER + a per-user purchases.view
// grant). Created once by the QA pass through POST /users; override with env.
const VIEW_ONLY_USER = process.env.E2E_VIEWONLY_USERNAME ?? "e2e_pur_viewonly";
const VIEW_ONLY_PASSWORD = process.env.E2E_VIEWONLY_PASSWORD;

test.describe("15) purchases.view-only user", () => {
  test.skip(!VIEW_ONLY_PASSWORD, "E2E_VIEWONLY_PASSWORD not set");

  test("sees no mutating actions on request/purchase pages and no create links in the sidebar", async ({ browser, request }) => {
    const pr = await createRequestViaApi(request, [{ name: `شیر بستنی QA ${uniqueSuffix()}`, quantity: 4 }], { approve: false });
    const purchaseId = await createPurchaseViaApi(request);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fa-IR" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#username").fill(VIEW_ONLY_USER);
    await page.locator("#password").fill(VIEW_ONLY_PASSWORD!);
    await page.getByRole("button", { name: "ورود" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto(`/purchase-requests/${pr.id}`);
    await expect(page.getByRole("heading", { name: `درخواست خرید ${pr.requestNumber}` })).toBeVisible();
    for (const name of ["تایید", "رد", "ثبت خرید", "ویرایش"]) {
      await expect(page.getByRole("main").getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "ثبت خرید", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ثبت درخواست خرید", exact: true })).toHaveCount(0);

    await page.goto("/purchase-requests");
    await expect(page.getByRole("heading", { name: "درخواست‌های خرید" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /درخواست خرید جدید|ویرایش/ })).toHaveCount(0);

    await page.goto(`/purchases/${purchaseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PUR-\d+$/);
    for (const name of ["ویرایش", "افزودن پرداخت", "افزودن سند", "ثبت برگشت", "حذف", "تأیید خرید", "لغو خرید"]) {
      await expect(page.getByRole("main").getByRole("button", { name })).toHaveCount(0);
    }
    await context.close();
  });

  // BUG: the create/edit form routes have no permission guard — a view-only
  // user who follows a link/bookmark gets a fully editable form that only
  // fails with a 403 toast on save.
  test("deep-linking to create/edit forms shows a no-access notice instead of an editable form", async ({ browser, request }) => {
    const pr = await createRequestViaApi(request, [{ name: `پودر آب‌پنیر QA ${uniqueSuffix()}`, quantity: 4 }], { approve: false });
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fa-IR" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#username").fill(VIEW_ONLY_USER);
    await page.locator("#password").fill(VIEW_ONLY_PASSWORD!);
    await page.getByRole("button", { name: "ورود" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto(`/purchase-requests/${pr.id}/edit`);
    await page.waitForTimeout(1500);
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toHaveCount(0);
    await page.goto("/purchases/new");
    await page.waitForTimeout(1500);
    await expect(page.locator('button[form="purchase-form"]')).toHaveCount(0);
    await context.close();
  });
});

// ---- 16. prefill tampering / stale links ----------------------------------------

// Business decision 2026-10-05 (#5): a purchase can only be linked to an
// APPROVED / PARTIALLY_PURCHASED request. A stale ?prefill= link to a request
// that was since REJECTED is refused on save, with a clear Persian message.
test("16) #5 a ?prefill= link for a request that was since REJECTED cannot be turned into a purchase", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `ماست موسیر QA ${uniqueSuffix()}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 6 }]);
  const detail = await getRequest(request, pr.id);
  // Reject it after the link was made (e.g. a bookmarked/shared link).
  const full = (await (await request.get(`${BACKEND}/purchase-requests/${pr.id}`)).json()) as {
    requestDate: string; updatedAt: string; purchaseType: { id: number }; requesterDepartment: { id: number }; priority: string; items: { id: number; name: string; quantity: string; unit: { id: number } }[];
  };
  const rejected = await request.patch(`${BACKEND}/purchase-requests/${pr.id}`, {
    data: {
      requestDate: full.requestDate, purchaseTypeId: full.purchaseType.id, requesterDepartmentId: full.requesterDepartment.id, priority: full.priority, note: QA_NOTE, status: "REJECTED",
      updatedAt: full.updatedAt,
      items: full.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitId: i.unit.id })),
    },
  });
  expect(rejected.ok()).toBeTruthy();

  const prefill = { purchaseRequestId: pr.id, items: [{ name, quantity: 6, unitId: md.unitId, purchaseRequestItemId: detail.items[0].id }] };
  await page.goto(`/purchases/new?prefill=${encodeURIComponent(JSON.stringify(prefill))}`);
  await expect(purchaseItemRow(page, 0).getByLabel("نام یا شرح قلم")).toHaveValue(name);
  await purchaseItemRow(page, 0).getByLabel("قیمت کل").fill("60000");
  await fillPurchaseHeader(page, md);
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("alert").filter({ hasText: "خرید فقط به درخواست خرید «تأییدشده» یا «خرید جزئی» قابل اتصال است" })).toBeVisible();
  await expect(page).toHaveURL(/\/purchases\/new/);
  const after = await getRequest(request, pr.id);
  expect(after.status).toBe("REJECTED");
  expect(after.items[0].purchasedQuantity, "a REJECTED request must not accumulate purchased quantity").toBe(0);
});

// Was a low-severity bug (the picker showed "بدون درخواست خرید" while the
// form still held the unknown id, so the save failed with "درخواست خرید
// انتخاب‌شده یافت نشد"). Fixed 2026-10-06: the unknown link is dropped, with
// a notice, and the lines stay as plain unlinked lines.
test("16b) a ?prefill= link pointing at a non-existent request does not leave a hidden request id on the form", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `QA درخواست ناموجود ${uniqueSuffix()}`;
  const prefill = { purchaseRequestId: 99999999, items: [{ name, quantity: 1, unitId: md.unitId, purchaseRequestItemId: 99999999 }] };
  await page.goto(`/purchases/new?prefill=${encodeURIComponent(JSON.stringify(prefill))}`);
  await expect(purchaseItemRow(page, 0).getByLabel("نام یا شرح قلم")).toHaveValue(name);
  // The picker shows "no request" — so saving must not be refused because of a request.
  await expect(page.locator("#purchase-request")).toContainText("بدون درخواست خرید");
  await expect(page.getByRole("alert").filter({ hasText: "درخواست خرید مشخص‌شده در پیوند یافت نشد" })).toBeVisible();
  await purchaseItemRow(page, 0).getByLabel("قیمت کل").fill("10000");
  await fillPurchaseHeader(page, md);
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/purchases\/\d+$/);
  const created = await getPurchase(request, Number(new URL(page.url()).pathname.split("/").pop()));
  expect(created.items.map((item) => item.name)).toEqual([name]);
});

// ---- 17. refresh / back mid-form -----------------------------------------------

// Fixed 2026-10-06 (was a test.fail UX gap). The guard lives in
// PurchaseForm.tsx only: the browser's beforeunload prompt for full page
// unloads, a window.confirm for real <a> links and the form's own «انصراف».
// NOT covered: the app-shell sidebar, which navigates via router.push() from
// buttons (no link, no unload) — needs a shared navigation guard if wanted.
test("17) refreshing or leaving a half-filled purchase form warns before discarding typed data", async ({ page }) => {
  await page.goto("/purchases/new");
  const nameField = purchaseItemRow(page, 0).getByLabel("نام یا شرح قلم");
  // A real click first: browsers only show beforeunload prompts after user activation.
  await nameField.click();
  await nameField.fill("شیر خام QA رفرش");

  // «انصراف» asks first; dismissing keeps the form and its data.
  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "انصراف" }).click();
  await expect.poll(() => confirmText).toContain("تغییرات ذخیره‌نشده");
  await expect(page).toHaveURL(/\/purchases\/new$/);
  await expect(nameField).toHaveValue("شیر خام QA رفرش");

  // A full page unload (closing the tab / reload) gets the browser's own beforeunload prompt.
  let unloadPrompted = false;
  page.once("dialog", (dialog) => {
    unloadPrompted = dialog.type() === "beforeunload";
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => unloadPrompted).toBe(true);
});

test("17a) an edited purchase form asks before following an in-page link; accepting leaves", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}/edit`);
  await expect(page.locator("#purchase-note")).toHaveValue(QA_NOTE);
  await page.locator("#purchase-note").fill(`${QA_NOTE} — ویرایش نیمه‌کاره`);
  const paymentsLink = page.getByRole("link", { name: /ثبت\/مشاهده پرداخت‌ها/ });

  page.once("dialog", (dialog) => void dialog.dismiss());
  await paymentsLink.click();
  await expect(page).toHaveURL(new RegExp(`/purchases/${purchaseId}/edit$`));
  await expect(page.locator("#purchase-note")).toHaveValue(`${QA_NOTE} — ویرایش نیمه‌کاره`);

  page.once("dialog", (dialog) => void dialog.accept());
  await paymentsLink.click();
  await expect(page).toHaveURL(new RegExp(`/purchases/${purchaseId}$`));
});

test("17b) an untouched purchase form (new or edit) reloads and leaves without any prompt", async ({ page, request }) => {
  let prompted = false;
  page.on("dialog", (dialog) => {
    prompted = true;
    void dialog.accept();
  });
  await page.goto("/purchases/new");
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();

  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}/edit`);
  await expect(page.locator("#purchase-note")).toHaveValue(QA_NOTE);
  await page.getByRole("link", { name: /ثبت\/مشاهده پرداخت‌ها/ }).click();
  await expect(page).toHaveURL(new RegExp(`/purchases/${purchaseId}$`));
  expect(prompted).toBe(false);
});

// ---- 18. business-owner decisions of 2026-10-05 ---------------------------------
// One regression test (or more) per decided rule. #9 (non-gapless numbers)
// and #11 (shrink rule, covered by 6/6b above) needed no change.

type PurchaseJson = {
  id: number;
  status: string;
  updatedAt: string;
  totalAmount: string;
  paidAmount: string;
  paymentStatus: string;
  purchaseDate: string;
  purchaseTypeId: number;
  supplierId: number;
  requesterDepartmentId: number | null;
  buyerEmployeeId: number | null;
  note: string | null;
  items: { id: number; name: string; quantity: string; unitId: number; unitPrice: string | null; totalPrice: string }[];
};

async function getPurchase(request: APIRequestContext, id: number): Promise<PurchaseJson> {
  const response = await request.get(`${BACKEND}/purchases/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PurchaseJson;
}

// The full PATCH body for a purchase as currently stored, with overrides.
function purchasePatchBody(purchase: PurchaseJson, overrides: Record<string, unknown> = {}) {
  return {
    purchaseDate: purchase.purchaseDate,
    purchaseTypeId: purchase.purchaseTypeId,
    sourceType: "OPERATIONAL",
    requesterDepartmentId: purchase.requesterDepartmentId,
    buyerEmployeeId: purchase.buyerEmployeeId,
    supplierId: purchase.supplierId,
    note: purchase.note ?? "",
    status: purchase.status,
    updatedAt: purchase.updatedAt,
    items: purchase.items.map((item) => ({
      name: item.name,
      quantity: Number(item.quantity),
      unitId: item.unitId,
      unitPrice: item.unitPrice === null ? undefined : Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    })),
    ...overrides,
  };
}

async function createReturnViaApi(request: APIRequestContext, purchaseId: number) {
  const purchase = await getPurchase(request, purchaseId);
  const response = await request.post(`${BACKEND}/purchases/${purchaseId}/returns`, {
    data: { returnDate: localTodayIso(), reason: "QA برگشت آزمایشی", note: QA_NOTE, items: [{ purchaseItemId: purchase.items[0].id, quantity: 1, creditAmount: 1000 }] },
  });
  if (!response.ok()) throw new Error(`Failed to create return: ${response.status()} ${await response.text()}`);
  return (await response.json()) as { id: number; returnNumber: string };
}

test("18.1) #1 overpaying is allowed but shown as a clear warning, right after the payment and persistently", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await expect(page.getByRole("alert").filter({ hasText: "پرداخت بیش از مبلغ خرید" })).toHaveCount(0);

  await addPayment(page, "600000", "COMPLETED");
  const banner = page.getByRole("alert").filter({ hasText: "پرداخت بیش از مبلغ خرید" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(fa(100000));
  await expect(paymentSummaryCell(page, "مبلغ باقی‌مانده")).toHaveText(`${fa(100000)} ریال اضافه پرداخت`);

  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "پرداخت بیش از مبلغ خرید" })).toBeVisible();
  const purchase = await getPurchase(request, purchaseId);
  expect(purchase).toMatchObject({ totalAmount: "500000", paidAmount: "600000", paymentStatus: "PAID" });
});

test("18.2) #2 payments only on CONFIRMED/RECEIVED/CLOSED and returns only on RECEIVED/CLOSED — buttons hidden and the API refuses", async ({ page, request }) => {
  const draftId = await createPurchaseViaApi(request, 500_000);
  await page.goto(`/purchases/${draftId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PUR-\d+$/);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toHaveCount(0);
  await expect(page.getByText("ثبت پرداخت فقط برای خرید «تأییدشده»، «دریافت‌شده» یا «بسته‌شده» امکان‌پذیر است.")).toBeVisible();
  const draftPayment = await request.post(`${BACKEND}/purchases/${draftId}/payments`, { data: { amount: 1000, paymentDate: localTodayIso(), method: "CASH" } });
  expect(draftPayment.status()).toBe(409);
  expect((await draftPayment.json()).message).toContain("پرداخت فقط برای خرید");

  const confirmedId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${confirmedId}`);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toHaveCount(0);
  const confirmed = await getPurchase(request, confirmedId);
  const confirmedReturn = await request.post(`${BACKEND}/purchases/${confirmedId}/returns`, {
    data: { returnDate: localTodayIso(), reason: "x", items: [{ purchaseItemId: confirmed.items[0].id, quantity: 1, creditAmount: 1 }] },
  });
  expect(confirmedReturn.status()).toBe(409);
  expect((await confirmedReturn.json()).message).toContain("برگشت فقط برای خرید");

  const receivedId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
  await page.goto(`/purchases/${receivedId}`);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toBeVisible();
});

test("18.3) #3 a return's credit cannot exceed the line's remaining value (dialog stays open)", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 1_000_000, "RECEIVED");
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "ثبت برگشت" }).click();
  const dialog = page.getByRole("dialog");
  await selectJalaliToday(dialog, "return-date");
  await dialog.locator("#return-reason").fill("QA اعتبار بیش از ارزش");
  await selectFirstRealOption(dialog.getByLabel("قلم خرید"));
  await dialog.getByLabel("مقدار برگشتی").fill("1");
  await dialog.getByLabel("مبلغ اعتبار").fill("1000001");
  await dialog.getByRole("button", { name: "ثبت برگشت" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "بیشتر از ارزش باقی‌ماندهٔ قابل برگشت" })).toBeVisible();
  await expect(dialog).toBeVisible();
  const returns = (await (await request.get(`${BACKEND}/purchases/${purchaseId}/returns`)).json()) as unknown[];
  expect(returns).toHaveLength(0);
});

test("18.4) #4 implausible years and out-of-order dates are refused by the API, and the date picker can't offer them", async ({ page, request }) => {
  const md = await masterData(request);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const base = {
    purchaseTypeId: types[0].id, sourceType: "OPERATIONAL", requesterDepartmentId: md.departmentId, buyerEmployeeId: md.employeeId,
    supplierId: suppliers.find((s) => s.status === "active")!.id, note: QA_NOTE,
    items: [{ name: `QA تاریخ ${uniqueSuffix()}`, quantity: 1, unitId: md.unitId, totalPrice: 1000 }],
  };
  for (const purchaseDate of ["9999-12-31", "1404-07-13"]) {
    const response = await request.post(`${BACKEND}/purchases`, { data: { ...base, purchaseDate } });
    expect(response.status(), purchaseDate).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("۱۳۰۰ تا ۱۴۹۹");
  }

  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  const before = await request.post(`${BACKEND}/purchases/${purchaseId}/payments`, { data: { amount: 1000, paymentDate: "2000-01-01", method: "CASH" } });
  expect(before.status()).toBe(409);
  expect((await before.json()).message).toBe("تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد");

  const requestResponse = await request.post(`${BACKEND}/purchase-requests`, {
    data: { requestDate: "2026-10-01", purchaseTypeId: types[0].id, requesterDepartmentId: md.departmentId, note: QA_NOTE, items: [{ name: "QA نیاز", quantity: 1, unitId: md.unitId, requiredDate: "2026-09-01" }] },
  });
  expect(requestResponse.status()).toBe(400);
  expect(JSON.stringify(await requestResponse.json())).toContain("نمی‌تواند قبل از تاریخ درخواست باشد");

  // The picker never offers a year outside 1300–1499.
  await page.goto("/purchases/new");
  const years = await page.locator("#purchase-date-year option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter(Boolean).map(Number));
  expect(Math.min(...years)).toBeGreaterThanOrEqual(1300);
  expect(Math.max(...years)).toBeLessThanOrEqual(1499);
});

test("18.5) #5 linking needs an APPROVED/PARTIALLY_PURCHASED request; buying more than requested needs an explicit confirmation", async ({ page, request }) => {
  const md = await masterData(request);
  const draft = await createRequestViaApi(request, [{ name: `QA پیش‌نویس ${uniqueSuffix()}`, quantity: 3 }], { approve: false });
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const linkDraft = await request.post(`${BACKEND}/purchases`, {
    data: {
      purchaseDate: localTodayIso(), purchaseTypeId: types[0].id, sourceType: "OPERATIONAL", requesterDepartmentId: md.departmentId,
      buyerEmployeeId: md.employeeId, supplierId: suppliers.find((s) => s.status === "active")!.id, purchaseRequestId: draft.id, note: QA_NOTE,
      items: [{ name: "QA", quantity: 1, unitId: md.unitId, totalPrice: 1000 }],
    },
  });
  expect(linkDraft.status()).toBe(409);

  const name = `دوغ گازدار QA ${uniqueSuffix()}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 5 }]);
  const detail = await getRequest(request, pr.id);
  const prefill = { purchaseRequestId: pr.id, items: [{ name, quantity: 7, unitId: md.unitId, purchaseRequestItemId: detail.items[0].id }] };
  await page.goto(`/purchases/new?prefill=${encodeURIComponent(JSON.stringify(prefill))}`);
  await expect(purchaseItemRow(page, 0).getByLabel("مقدار", { exact: true })).toHaveValue("7");
  await purchaseItemRow(page, 0).getByLabel("قیمت کل").fill("70000");
  await fillPurchaseHeader(page, md);
  await page.locator('button[form="purchase-form"]').click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "خرید بیش از مقدار درخواست‌شده" })).toBeVisible();
  await expect(dialog).toContainText(name);
  await expect(dialog).toContainText(`مازاد: ${fa(2)}`);
  // Cancelling saves nothing.
  await dialog.getByRole("button", { name: "انصراف" }).click();
  await expect(page).toHaveURL(/\/purchases\/new/);
  expect((await getRequest(request, pr.id)).items[0].purchasedQuantity).toBe(0);

  await page.locator('button[form="purchase-form"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "بله، خرید مازاد را ثبت کن" }).click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/purchases\/\d+$/);
  const after = await getRequest(request, pr.id);
  expect(after.items[0].purchasedQuantity).toBe(7);
  expect(after.status).toBe("COMPLETED");
});

test("18.6) #6 a purchase whose item totals sum to 0 is refused with a Persian message", async ({ page, request }) => {
  const md = await masterData(request);
  await page.goto("/purchases/new");
  await fillPurchaseHeader(page, md);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(`QA رایگان ${uniqueSuffix()}`);
  await row.getByLabel("مقدار", { exact: true }).fill("1");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("قیمت کل").fill("0");
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("alert").filter({ hasText: "جمع مبلغ اقلام خرید باید بیشتر از صفر باشد" })).toBeVisible();
  await expect(page).toHaveURL(/\/purchases\/new/);
});

test("18.7) #7 a payment can be edited in place (PENDING → COMPLETED, new amount) and the paid amount follows", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 1_000_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await addPayment(page, "300000", "PENDING");
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(0)} ریال`);

  await page.locator("tbody tr").filter({ hasText: fa(300000) }).getByRole("button", { name: "ویرایش" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "ویرایش پرداخت" })).toBeVisible();
  await expect(dialog.locator("#payment-amount")).toHaveValue("300000");
  await dialog.locator("#payment-amount").fill("400000");
  await dialog.locator("#payment-status").selectOption("COMPLETED");
  await dialog.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("status").filter({ hasText: "پرداخت با موفقیت ویرایش شد." })).toBeVisible();
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(400000)} ریال`);
  const purchase = (await (await request.get(`${BACKEND}/purchases/${purchaseId}`)).json()) as { payments: { amount: string; status: string }[] };
  expect(purchase.payments).toHaveLength(1);
  expect(purchase.payments[0]).toMatchObject({ amount: "400000", status: "COMPLETED" });
});

test("18.10) #10 a purchase with a return can be neither edited nor cancelled — but it can be closed (2026-10-06)", async ({ request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
  await createReturnViaApi(request, purchaseId);
  const purchase = await getPurchase(request, purchaseId);

  const edit = await request.patch(`${BACKEND}/purchases/${purchaseId}`, { data: purchasePatchBody(purchase, { note: `${QA_NOTE} — ویرایش` }) });
  expect(edit.status()).toBe(409);
  expect((await edit.json()).message).toContain("برگشت به تأمین‌کننده ثبت شده است");

  const cancel = await request.patch(`${BACKEND}/purchases/${purchaseId}/status`, { data: { status: "CANCELLED", updatedAt: purchase.updatedAt } });
  expect(cancel.status()).toBe(409);
  expect((await cancel.json()).message).toContain("برگشت به تأمین‌کننده ثبت شده است");
  const afterCancel = await getPurchase(request, purchaseId);
  expect(afterCancel.status).toBe("RECEIVED");

  // Closing is a status-only change that never touches the items the return
  // points at, so it succeeds — and the return and items survive intact.
  const close = await request.patch(`${BACKEND}/purchases/${purchaseId}/status`, { data: { status: "CLOSED", updatedAt: afterCancel.updatedAt } });
  expect(close.status()).toBe(200);
  const closed = await getPurchase(request, purchaseId);
  expect(closed.status).toBe("CLOSED");
  expect(closed.items.map((item) => item.id)).toEqual(purchase.items.map((item) => item.id));
  const returns = (await (await request.get(`${BACKEND}/purchases/${purchaseId}/returns`)).json()) as unknown[];
  expect(returns).toHaveLength(1);
});

test("18.10b) PATCH /purchases/:id refuses a status change — status moves only through /status", async ({ request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  const purchase = await getPurchase(request, purchaseId);
  const viaEdit = await request.patch(`${BACKEND}/purchases/${purchaseId}`, { data: purchasePatchBody(purchase, { status: "RECEIVED" }) });
  expect(viaEdit.status()).toBe(409);
  expect((await viaEdit.json()).message).toContain("تغییر وضعیت از این مسیر مجاز نیست");
  expect((await getPurchase(request, purchaseId)).status).toBe("CONFIRMED");

  // Skipping a step is refused too.
  const skip = await request.patch(`${BACKEND}/purchases/${purchaseId}/status`, { data: { status: "CLOSED", updatedAt: purchase.updatedAt } });
  expect(skip.status()).toBe(409);
  expect((await getPurchase(request, purchaseId)).status).toBe("CONFIRMED");
});

test("18.12a) #12 a purchase edit form opened before someone else saved is refused on save and must reload", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000);
  await page.goto(`/purchases/${purchaseId}/edit`);
  await expect(page.getByRole("heading", { name: "ویرایش خرید" })).toBeVisible();
  await expect(page.locator("#purchase-note")).toHaveValue(QA_NOTE);

  // Someone else saves in between.
  const current = await getPurchase(request, purchaseId);
  const other = await request.patch(`${BACKEND}/purchases/${purchaseId}`, { data: purchasePatchBody(current, { note: `${QA_NOTE} — کاربر دیگر` }) });
  expect(other.ok()).toBeTruthy();

  await page.locator("#purchase-note").fill(`${QA_NOTE} — این فرم`);
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("alert").filter({ hasText: "توسط کاربر دیگری تغییر کرده است" }).first()).toBeVisible();
  await expect(page.locator('button[form="purchase-form"]')).toBeDisabled();
  expect((await getPurchase(request, purchaseId)).note).toBe(`${QA_NOTE} — کاربر دیگر`);
});

test("18.12b) #12 تایید on a request page that is out of date is refused, and the actions stay disabled until reload", async ({ page, request }) => {
  const pr = await createRequestViaApi(request, [{ name: `QA نسخه ${uniqueSuffix()}`, quantity: 2 }], { approve: false });
  await openRequestDetail(page, pr.id, pr.requestNumber);
  const full = (await (await request.get(`${BACKEND}/purchase-requests/${pr.id}`)).json()) as {
    requestDate: string; updatedAt: string; purchaseType: { id: number }; requesterDepartment: { id: number }; priority: string; items: { id: number; name: string; quantity: string; unit: { id: number } }[];
  };
  const other = await request.patch(`${BACKEND}/purchase-requests/${pr.id}`, {
    data: {
      requestDate: full.requestDate, purchaseTypeId: full.purchaseType.id, requesterDepartmentId: full.requesterDepartment.id, priority: "URGENT", note: QA_NOTE, status: "DRAFT", updatedAt: full.updatedAt,
      items: full.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitId: i.unit.id })),
    },
  });
  expect(other.ok()).toBeTruthy();

  await page.getByRole("button", { name: "تایید", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "توسط کاربر دیگری تغییر کرده است" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تایید", exact: true })).toBeDisabled();
  expect((await getRequest(request, pr.id)).status).toBe("DRAFT");

  await page.getByRole("button", { name: "بازخوانی صفحه" }).click();
  await page.getByRole("button", { name: "تایید", exact: true }).click();
  await expect(requestHeader(page)).toContainText("تأییدشده");
});

test("18.13) #13 the payment date picker offers future years (post-dated cheques), up to the 1499 bound", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await page.getByRole("button", { name: "افزودن پرداخت" }).click();
  const years = await page.getByRole("dialog").locator("#payment-date-year option").evaluateAll((options) =>
    options.map((o) => (o as HTMLOptionElement).value).filter(Boolean).map(Number),
  );
  const thisYear = jalaliToday().year;
  expect(years).toContain(thisYear + 1);
  expect(years).toContain(1499);
  expect(years).not.toContain(1500);

  // A payment dated next year is accepted.
  const dialog = page.getByRole("dialog");
  await dialog.locator("#payment-date-year").selectOption(String(thisYear + 1));
  await dialog.locator("#payment-date-month").selectOption("1");
  await dialog.locator("#payment-date-day").selectOption("1");
  await dialog.locator("#payment-amount").fill("1000");
  await dialog.locator("#payment-method").selectOption("CHECK");
  await dialog.getByRole("button", { name: "ثبت پرداخت" }).click();
  await expect(page.getByRole("status").filter({ hasText: "پرداخت با موفقیت ثبت شد." })).toBeVisible();
});

test.describe("18.8) #8 returns: purchases.view can read, only purchases.manage can create/delete", () => {
  test.skip(!VIEW_ONLY_PASSWORD, "E2E_VIEWONLY_PASSWORD not set");

  test("a purchases.view-only user sees the returns list but no return actions, and the API refuses a create", async ({ browser, request }) => {
    const purchaseId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
    const created = await createReturnViaApi(request, purchaseId);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fa-IR" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#username").fill(VIEW_ONLY_USER);
    await page.locator("#password").fill(VIEW_ONLY_PASSWORD!);
    await page.getByRole("button", { name: "ورود" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto(`/purchases/${purchaseId}`);
    await expect(page.getByText(created.returnNumber)).toBeVisible();
    await expect(page.getByText("اجازه دسترسی به برگشت‌های این خرید را ندارید.")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button", { name: "ثبت برگشت" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button", { name: "حذف" })).toHaveCount(0);

    const list = await page.request.get(`/api/purchases/${purchaseId}/returns`);
    expect(list.status()).toBe(200);
    const purchase = await getPurchase(request, purchaseId);
    const create = await page.request.post(`/api/purchases/${purchaseId}/returns`, {
      data: { returnDate: localTodayIso(), reason: "x", items: [{ purchaseItemId: purchase.items[0].id, quantity: 1, creditAmount: 1 }] },
    });
    expect(create.status()).toBe(403);
    await context.close();
  });
});

// ---- 19. new purchases default to CONFIRMED (business decision 2026-10-05) -------

test("19a) a purchase created with the form's defaults is CONFIRMED and takes a payment immediately — no DRAFT detour", async ({ page, request }) => {
  const md = await masterData(request);
  await page.goto("/purchases/new");
  // No status selector on the create form any more (business decision
  // 2026-10-06) — the purchase is simply created CONFIRMED.
  await expect(page.locator("#purchase-status")).toHaveCount(0);

  await fillPurchaseHeader(page, md);
  const row = purchaseItemRow(page, 0);
  await row.getByLabel("نام یا شرح قلم").fill(`QA پیش‌فرض تأییدشده ${uniqueSuffix()}`);
  await row.getByLabel("مقدار", { exact: true }).fill("2");
  await row.getByLabel("واحد", { exact: true }).selectOption(String(md.unitId));
  await row.getByLabel("قیمت کل").fill("200000");
  const purchaseId = await submitNewPurchase(page);

  await expect(page.getByRole("heading", { level: 1 }).locator("xpath=..")).toContainText("تأییدشده");
  await addPayment(page, "200000", null);
  await expect(paymentSummaryCell(page, "مبلغ پرداخت‌شده")).toHaveText(`${fa(200000)} ریال`);
  expect((await getPurchase(request, purchaseId)).status).toBe("CONFIRMED");
});

// 19b (choosing DRAFT on the create form) removed 2026-10-06: the create
// form no longer has a status selector. DRAFT via the API (still accepted)
// with payments unavailable is covered by 18.2 and 20a.

test("19c) the API defaults a new purchase to CONFIRMED and refuses creating one as RECEIVED/CLOSED/CANCELLED", async ({ request }) => {
  const md = await masterData(request);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const data = {
    purchaseDate: localTodayIso(), purchaseTypeId: types[0].id, sourceType: "OPERATIONAL", requesterDepartmentId: md.departmentId,
    buyerEmployeeId: md.employeeId, supplierId: suppliers.find((s) => s.status === "active")!.id, note: QA_NOTE,
    items: [{ name: `QA وضعیت ایجاد ${uniqueSuffix()}`, quantity: 1, unitId: md.unitId, totalPrice: 1000 }],
  };
  const created = await request.post(`${BACKEND}/purchases`, { data });
  expect(created.ok()).toBeTruthy();
  expect(((await created.json()) as { status: string }).status).toBe("CONFIRMED");
  for (const status of ["RECEIVED", "CLOSED", "CANCELLED"]) {
    const refused = await request.post(`${BACKEND}/purchases`, { data: { ...data, status } });
    expect(refused.status(), status).toBe(400);
  }
});


// ---- 20. status actions on the purchase detail page (business-owner request 2026-10-05) ----
//
// Status changes on an existing purchase are dedicated one-click actions on
// the detail page — تأیید خرید (DRAFT→CONFIRMED), ثبت دریافت کالا
// (CONFIRMED→RECEIVED), بستن خرید (RECEIVED→CLOSED), لغو خرید (DRAFT/
// CONFIRMED/RECEIVED→CANCELLED) — each behind a window.confirm. The edit form
// no longer has a status field.

const STATUS_ACTION_NAMES = ["تأیید خرید", "ثبت دریافت کالا", "بستن خرید", "لغو خرید"] as const;

function purchaseHeader(page: Page) {
  return page.getByRole("heading", { level: 1 }).locator("xpath=..");
}

function statusActionButton(page: Page, name: (typeof STATUS_ACTION_NAMES)[number]) {
  return page.getByRole("main").getByRole("button", { name, exact: true });
}

async function expectOnlyStatusActions(page: Page, visible: (typeof STATUS_ACTION_NAMES)[number][]) {
  for (const name of STATUS_ACTION_NAMES) {
    await expect(statusActionButton(page, name), name).toHaveCount(visible.includes(name) ? 1 : 0);
  }
}

test("20a) DRAFT → تأیید خرید → ثبت دریافت کالا → بستن خرید: each step updates the badge, the actions and payment/return buttons without a reload", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "DRAFT");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/purchases/${purchaseId}`);
  await expect(purchaseHeader(page)).toContainText("پیش‌نویس");
  await expectOnlyStatusActions(page, ["تأیید خرید", "لغو خرید"]);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toHaveCount(0);

  await statusActionButton(page, "تأیید خرید").click();
  await expect(page.getByRole("status").filter({ hasText: "خرید تأیید شد." })).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("تأییدشده");
  await expectOnlyStatusActions(page, ["ثبت دریافت کالا", "لغو خرید"]);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toHaveCount(0);
  expect((await getPurchase(request, purchaseId)).status).toBe("CONFIRMED");

  await statusActionButton(page, "ثبت دریافت کالا").click();
  await expect(page.getByRole("status").filter({ hasText: "دریافت کالا ثبت شد." })).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("دریافت‌شده");
  await expectOnlyStatusActions(page, ["بستن خرید", "لغو خرید"]);
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toBeVisible();
  expect((await getPurchase(request, purchaseId)).status).toBe("RECEIVED");

  await statusActionButton(page, "بستن خرید").click();
  await expect(page.getByRole("status").filter({ hasText: "خرید بسته شد." })).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("بسته‌شده");
  await expectOnlyStatusActions(page, []);
  // Payments/returns stay possible on a CLOSED purchase; editing other fields too.
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت برگشت" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "ویرایش", exact: true })).toBeVisible();
  const closed = await getPurchase(request, purchaseId);
  expect(closed.status).toBe("CLOSED");
  // Only the status changed — the items and totals came back unchanged.
  expect(closed.totalAmount).toBe("500000");
  expect(closed.items).toHaveLength(1);
  expect(closed.note).toBe(QA_NOTE);
});

test("20b) لغو خرید: dismissing the confirm changes nothing; accepting cancels and leaves no status actions", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "CONFIRMED");
  await page.goto(`/purchases/${purchaseId}`);
  await expectOnlyStatusActions(page, ["ثبت دریافت کالا", "لغو خرید"]);

  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    void dialog.dismiss();
  });
  await statusActionButton(page, "لغو خرید").click();
  await expect.poll(() => confirmText).toBe("آیا از لغو این خرید مطمئن هستید؟");
  await expect(purchaseHeader(page)).toContainText("تأییدشده");
  expect((await getPurchase(request, purchaseId)).status).toBe("CONFIRMED");

  page.once("dialog", (dialog) => void dialog.accept());
  await statusActionButton(page, "لغو خرید").click();
  await expect(page.getByRole("status").filter({ hasText: "خرید لغو شد." })).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("لغوشده");
  await expectOnlyStatusActions(page, []);
  await expect(page.getByRole("button", { name: "افزودن پرداخت" })).toHaveCount(0);
  expect((await getPurchase(request, purchaseId)).status).toBe("CANCELLED");
});

test("20c) لغو خرید is offered on DRAFT and RECEIVED too; CLOSED and CANCELLED are terminal (badge only)", async ({ page, request }) => {
  const draftId = await createPurchaseViaApi(request, 500_000, "DRAFT");
  await page.goto(`/purchases/${draftId}`);
  await expectOnlyStatusActions(page, ["تأیید خرید", "لغو خرید"]);

  const receivedId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
  await page.goto(`/purchases/${receivedId}`);
  await expectOnlyStatusActions(page, ["بستن خرید", "لغو خرید"]);

  const closedId = await createPurchaseViaApi(request, 500_000, "CLOSED");
  await page.goto(`/purchases/${closedId}`);
  await expect(purchaseHeader(page)).toContainText("بسته‌شده");
  await expectOnlyStatusActions(page, []);

  const cancelledId = await createPurchaseViaApi(request, 500_000, "CANCELLED");
  await page.goto(`/purchases/${cancelledId}`);
  await expect(purchaseHeader(page)).toContainText("لغوشده");
  await expectOnlyStatusActions(page, []);
});

test("20d) a status action on an out-of-date page is refused (RECORD_MODIFIED), the actions stay disabled until reload", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "DRAFT");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/purchases/${purchaseId}`);
  await expect(statusActionButton(page, "تأیید خرید")).toBeEnabled();

  // Someone else saves in between.
  const current = await getPurchase(request, purchaseId);
  const other = await request.patch(`${BACKEND}/purchases/${purchaseId}`, { data: purchasePatchBody(current, { note: `${QA_NOTE} — کاربر دیگر` }) });
  expect(other.ok()).toBeTruthy();

  await statusActionButton(page, "تأیید خرید").click();
  await expect(page.getByRole("alert").filter({ hasText: "توسط کاربر دیگری تغییر کرده است" }).first()).toBeVisible();
  await expect(statusActionButton(page, "تأیید خرید")).toBeDisabled();
  await expect(statusActionButton(page, "لغو خرید")).toBeDisabled();
  expect((await getPurchase(request, purchaseId)).status).toBe("DRAFT");

  await page.getByRole("button", { name: "بازخوانی صفحه" }).click();
  await statusActionButton(page, "تأیید خرید").click();
  await expect(purchaseHeader(page)).toContainText("تأییدشده");
  const after = await getPurchase(request, purchaseId);
  expect(after.status).toBe("CONFIRMED");
  // The other user's change was not overwritten.
  expect(after.note).toBe(`${QA_NOTE} — کاربر دیگر`);
});

// Business decision 2026-10-06: a purchase with a return can be CLOSED
// (status-only change, items untouched) but still not CANCELLED.
test("20e) a backend refusal is shown as a Persian error and nothing changes (a purchase with a return can't be cancelled) — but it can be closed", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
  await createReturnViaApi(request, purchaseId);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/purchases/${purchaseId}`);
  await statusActionButton(page, "لغو خرید").click();
  await expect(page.getByRole("alert").filter({ hasText: "برگشت به تأمین‌کننده ثبت شده است" }).first()).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("دریافت‌شده");
  // Not a stale-record refusal — the actions stay usable.
  await expect(statusActionButton(page, "بستن خرید")).toBeEnabled();
  expect((await getPurchase(request, purchaseId)).status).toBe("RECEIVED");

  await statusActionButton(page, "بستن خرید").click();
  await expect(page.getByRole("status").filter({ hasText: "خرید بسته شد." })).toBeVisible();
  await expect(purchaseHeader(page)).toContainText("بسته‌شده");
  await expectOnlyStatusActions(page, []);
  expect((await getPurchase(request, purchaseId)).status).toBe("CLOSED");
});

// Since 2026-10-06 status actions use the status-only endpoint, which never
// re-runs the item/overage checks — so no second (overage) confirm appears.
test("20f) a purchase that already buys more than its request moves through the status actions without re-confirming the overage", async ({ page, request }) => {
  const md = await masterData(request);
  const name = `کره QA ${uniqueSuffix()}`;
  const pr = await createRequestViaApi(request, [{ name, quantity: 5 }]);
  const detail = await getRequest(request, pr.id);
  const types = (await (await request.get(`${BACKEND}/purchase-types`)).json()) as Array<{ id: number }>;
  const suppliers = (await (await request.get(`${BACKEND}/suppliers`)).json()) as Array<{ id: number; status: string }>;
  const created = await request.post(`${BACKEND}/purchases`, {
    data: {
      purchaseDate: localTodayIso(), purchaseTypeId: types[0].id, sourceType: "OPERATIONAL", requesterDepartmentId: md.departmentId,
      buyerEmployeeId: md.employeeId, supplierId: suppliers.find((s) => s.status === "active")!.id, purchaseRequestId: pr.id, note: QA_NOTE,
      confirmOverage: true,
      items: [{ name, quantity: 7, unitId: md.unitId, totalPrice: 70000, purchaseRequestItemId: detail.items[0].id }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const purchaseId = ((await created.json()) as { id: number }).id;

  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  await page.goto(`/purchases/${purchaseId}`);
  await statusActionButton(page, "ثبت دریافت کالا").click();
  await expect(purchaseHeader(page)).toContainText("دریافت‌شده");
  expect(messages).toEqual(["آیا دریافت کالای این خرید را تأیید می‌کنید؟"]);
  const after = await getPurchase(request, purchaseId);
  expect(after.status).toBe("RECEIVED");
  // The fulfillment link to the request line survived the status change.
  expect((await getRequest(request, pr.id)).items[0].purchasedQuantity).toBe(7);
});

test("20g) the purchase edit form has no status field and saving it keeps the current status", async ({ page, request }) => {
  const purchaseId = await createPurchaseViaApi(request, 500_000, "RECEIVED");
  await page.goto(`/purchases/${purchaseId}/edit`);
  await expect(page.getByRole("heading", { name: "ویرایش خرید" })).toBeVisible();
  await expect(page.locator("#purchase-note")).toHaveValue(QA_NOTE);
  await expect(page.locator("#purchase-status")).toHaveCount(0);
  await expect(page.getByText("وضعیت خرید", { exact: true })).toHaveCount(0);

  await page.locator("#purchase-note").fill(`${QA_NOTE} — ویرایش`);
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید با موفقیت ویرایش شد." })).toBeVisible();
  await page.waitForURL(/\/purchases\/\d+$/);
  const after = await getPurchase(request, purchaseId);
  expect(after.status).toBe("RECEIVED");
  expect(after.note).toBe(`${QA_NOTE} — ویرایش`);
});
