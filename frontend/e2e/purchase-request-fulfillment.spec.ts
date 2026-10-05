import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Closes the "no E2E coverage of Purchase Request → Purchase fulfillment"
// gap: the header "ثبت خرید" (formerly "ایجاد خرید کامل") and per-item
// "ایجاد خرید" / "خرید باقی‌مانده" actions on the Purchase Request detail page, and the automatic status recompute
// (PurchaseRequestsService.recomputeStatus()) that follows.
//
// What recomputeStatus() actually requires (read from the service, not
// assumed): it sums PurchaseItem.quantity per request item across every
// linked purchase whose status is NOT CANCELLED (a DRAFT one counts too).
// So simply *creating* the purchase (CONFIRMED by default since 2026-10-05)
// already moves the request:
//   nothing purchased -> APPROVED, some -> PARTIALLY_PURCHASED,
//   every item fully covered -> COMPLETED.
// It only acts on requests already in APPROVED/PARTIALLY_PURCHASED/COMPLETED.
//
// Arrange steps (request + its approval, buyer employee) go straight through
// the backend API, as purchases.spec.ts does. Moving a request to APPROVED is
// an ordinary user decision (the edit form offers it); PARTIALLY_PURCHASED /
// COMPLETED are never set directly here — only observed after the system
// recomputes them.

test.describe.configure({ mode: "serial" });

const BACKEND = "http://localhost:3001";

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function uniqueDigits(length: number): string {
  const source = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return source.slice(-length).padStart(length, "0");
}

function fa(value: number): string {
  return value.toLocaleString("fa-IR");
}

async function firstActiveDepartmentId(request: APIRequestContext): Promise<number> {
  const departments = (await (await request.get(`${BACKEND}/departments`)).json()) as Array<{ id: number; status: string }>;
  const department = departments.find((d) => d.status === "active");
  if (!department) throw new Error("No active department is seeded — required for this test.");
  return department.id;
}

async function firstUnitId(request: APIRequestContext): Promise<number> {
  const units = (await (await request.get(`${BACKEND}/units`)).json()) as Array<{ id: number }>;
  if (units.length === 0) throw new Error("No unit is seeded — required for this test.");
  return units[0].id;
}

async function createActiveEmployee(request: APIRequestContext, departmentId: number): Promise<number> {
  const response = await request.post(`${BACKEND}/employees`, {
    data: {
      firstName: "مریم",
      lastName: "احمدی",
      departmentId,
      nationalId: uniqueDigits(10),
      mobilePhone: `09${uniqueDigits(9)}`,
      birthDate: "1990-01-01",
      hireDate: "2020-01-01",
    },
  });
  if (!response.ok()) throw new Error(`Failed to create employee: ${response.status()} ${await response.text()}`);
  return ((await response.json()) as { id: number }).id;
}

type RequestItemInput = { name: string; quantity: number };

// Creates a request (always born DRAFT) and, unless told otherwise, approves
// it — the user-level decision that makes it eligible for purchasing.
async function createPurchaseRequest(
  request: APIRequestContext,
  items: RequestItemInput[],
  options: { approve: boolean } = { approve: true },
): Promise<{ id: number; requestNumber: string; unitId: number }> {
  const departmentId = await firstActiveDepartmentId(request);
  const unitId = await firstUnitId(request);
  const payload = {
    requestDate: "2025-03-21",
    requesterDepartmentId: departmentId,
    priority: "NORMAL",
    items: items.map((item) => ({ name: item.name, quantity: item.quantity, unitId })),
  };
  const created = await request.post(`${BACKEND}/purchase-requests`, { data: payload });
  if (!created.ok()) throw new Error(`Failed to create purchase request: ${created.status()} ${await created.text()}`);
  const body = (await created.json()) as { id: number; requestNumber: string; status: string; updatedAt: string };
  expect(body.status).toBe("DRAFT");

  if (options.approve) {
    // updatedAt = the optimistic-locking token every PATCH must send back.
    const approved = await request.patch(`${BACKEND}/purchase-requests/${body.id}`, { data: { ...payload, status: "APPROVED", updatedAt: body.updatedAt } });
    if (!approved.ok()) throw new Error(`Failed to approve purchase request: ${approved.status()} ${await approved.text()}`);
  }
  return { id: body.id, requestNumber: body.requestNumber, unitId };
}

async function openRequestDetail(page: Page, requestId: number, requestNumber: string) {
  await page.goto(`/purchase-requests/${requestId}`);
  await expect(page.getByRole("heading", { name: `درخواست خرید ${requestNumber}` })).toBeVisible();
}

// The request's own status badge sits next to the <h1>, separate from the
// "خریدهای مرتبط" table's per-purchase badges (whose labels overlap, e.g.
// "تأییدشده"/"لغوشده" exist for both), so it's scoped to the header block.
function requestHeader(page: Page) {
  return page.getByRole("heading", { level: 1 }).locator("xpath=../..");
}

// The header "ثبت خرید" action (pre-fills every item with remaining
// quantity). Scoped to the header: the sidebar has its own quick link. It is
// always rendered for a purchases.manage user, but disabled (with a tooltip
// explaining why) unless the request is APPROVED/PARTIALLY_PURCHASED and
// something is still left to buy.
function createFullPurchaseButton(page: Page) {
  return requestHeader(page).getByRole("button", { name: "ثبت خرید", exact: true });
}

function requestedItemRow(page: Page, itemName: string) {
  return page.locator("tbody tr").filter({ hasText: itemName });
}

async function expectItemQuantities(page: Page, itemName: string, purchased: number, remaining: number) {
  const cells = requestedItemRow(page, itemName).locator("td");
  await expect(cells.nth(2)).toHaveText(fa(purchased));
  await expect(cells.nth(3)).toHaveText(fa(remaining));
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
}

function purchaseItemRow(page: Page, index: number) {
  return page.locator("form#purchase-form table tbody tr").nth(index);
}

// Asserts the Purchase form arrived pre-filled from the request exactly as
// the detail page's action encoded it: linked request, item name(s),
// quantity (the remaining quantity), and unit — prices left for the user.
async function expectPrefilledPurchaseForm(
  page: Page,
  expected: { requestNumber: string; unitId: number; items: { name: string; quantity: number }[] },
) {
  await expect(page).toHaveURL(/\/\/[^/]+\/purchases\/new\?prefill=/);
  await expect(page.getByRole("heading", { name: "ثبت خرید جدید" })).toBeVisible();
  // "#purchase-request" is a custom Base UI Select trigger (not a native
  // <select>), so it's checked by its visible label, not a form value.
  await expect(page.locator("#purchase-request")).toContainText(expected.requestNumber);
  await expect(page.locator("form#purchase-form table tbody tr")).toHaveCount(expected.items.length);
  for (const [index, item] of expected.items.entries()) {
    const row = purchaseItemRow(page, index);
    await expect(row.getByLabel("نام یا شرح قلم")).toHaveValue(item.name);
    await expect(row.getByLabel("مقدار")).toHaveValue(String(item.quantity));
    await expect(row.getByLabel("واحد", { exact: true })).toHaveValue(String(expected.unitId));
    await expect(row.getByLabel("قیمت کل")).toHaveValue("");
  }
}

// Fills in everything the prefill deliberately leaves to the user, then saves.
async function completeAndSubmitPurchaseForm(page: Page, employeeId: number, totalPrices: string[]) {
  await selectJalaliDate(page, "purchase-date", { year: 1404, month: 1, day: 2 });
  await selectFirstRealOption(page, "purchase-type");
  await selectFirstRealOption(page, "purchase-supplier");
  await selectFirstRealOption(page, "purchase-department");
  await page.locator("#purchase-buyer").selectOption(String(employeeId));
  for (const [index, totalPrice] of totalPrices.entries()) {
    await purchaseItemRow(page, index).getByLabel("قیمت کل").fill(totalPrice);
  }
  // button[form="purchase-form"] — the sidebar has a same-named quick link.
  await page.locator('button[form="purchase-form"]').click();
  await expect(page.getByRole("status").filter({ hasText: "خرید جدید با موفقیت ثبت شد." })).toBeVisible();
  await page.waitForURL(/\/\/[^/]+\/purchases\/\d+$/);
  return Number(new URL(page.url()).pathname.split("/").pop());
}

test("1) 'ایجاد خرید کامل' pre-fills every item, and saving it recomputes the request to COMPLETED (and back to APPROVED on cancel)", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const itemA = { name: `قلم کامل الف ${suffix}`, quantity: 10 };
  const itemB = { name: `قلم کامل ب ${suffix}`, quantity: 3 };
  const pr = await createPurchaseRequest(request, [itemA, itemB]);
  const employeeId = await createActiveEmployee(request, await firstActiveDepartmentId(request));

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("تأییدشده");
  await expectItemQuantities(page, itemA.name, 0, 10);
  await expectItemQuantities(page, itemB.name, 0, 3);
  await expect(page.getByText("هنوز خریدی از این درخواست ثبت نشده است.")).toBeVisible();

  await createFullPurchaseButton(page).click();
  await expectPrefilledPurchaseForm(page, { requestNumber: pr.requestNumber, unitId: pr.unitId, items: [itemA, itemB] });

  const purchaseId = await completeAndSubmitPurchaseForm(page, employeeId, ["1000000", "300000"]);

  // Back on the request: the status moved on its own, from real quantities.
  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("تکمیل‌شده");
  await expect(requestHeader(page)).not.toContainText("تأییدشده");
  await expectItemQuantities(page, itemA.name, 10, 0);
  await expectItemQuantities(page, itemB.name, 3, 0);
  await expect(page.getByLabel("این قلم به‌طور کامل خریداری شده است")).toHaveCount(2);
  await expect(createFullPurchaseButton(page)).toBeDisabled();
  const linkedPurchases = page.locator("table").last();
  await expect(linkedPurchases.getByRole("link", { name: /^PUR-\d+$/ })).toHaveCount(1);
  // New purchases default to CONFIRMED (business decision 2026-10-05).
  await expect(linkedPurchases).toContainText("تأییدشده");

  // Reverse direction: cancelling the only linked purchase removes its
  // quantities from the sum, so the system puts the request back to APPROVED.
  // (Status changes are the detail page's «لغو خرید» action now, not an
  // edit-form field.)
  await page.goto(`/purchases/${purchaseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PUR-\d+$/);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("main").getByRole("button", { name: "لغو خرید", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "خرید لغو شد." })).toBeVisible();

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("تأییدشده");
  await expect(requestHeader(page)).not.toContainText("تکمیل‌شده");
  await expectItemQuantities(page, itemA.name, 0, 10);
  await expectItemQuantities(page, itemB.name, 0, 3);
  await expect(createFullPurchaseButton(page)).toBeEnabled();
});

test("2) per-item 'ایجاد خرید' for part of the quantity -> PARTIALLY_PURCHASED; then 'خرید باقی‌مانده' -> COMPLETED", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const item = { name: `قلم جزئی ${suffix}`, quantity: 10 };
  const pr = await createPurchaseRequest(request, [item]);
  const employeeId = await createActiveEmployee(request, await firstActiveDepartmentId(request));

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await requestedItemRow(page, item.name).getByRole("button", { name: "ایجاد خرید" }).click();
  await expectPrefilledPurchaseForm(page, { requestNumber: pr.requestNumber, unitId: pr.unitId, items: [item] });

  // Quantity stays editable on the pre-filled form — buy only 4 of 10.
  await purchaseItemRow(page, 0).getByLabel("مقدار").fill("4");
  await completeAndSubmitPurchaseForm(page, employeeId, ["400000"]);

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("خرید جزئی");
  await expectItemQuantities(page, item.name, 4, 6);

  // The per-item action now offers the remainder, pre-filled with 6.
  await requestedItemRow(page, item.name).getByRole("button", { name: "خرید باقی‌مانده" }).click();
  await expectPrefilledPurchaseForm(page, { requestNumber: pr.requestNumber, unitId: pr.unitId, items: [{ name: item.name, quantity: 6 }] });
  await completeAndSubmitPurchaseForm(page, employeeId, ["600000"]);

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("تکمیل‌شده");
  await expectItemQuantities(page, item.name, 10, 0);
  await expect(page.locator("table").last().getByRole("link", { name: /^PUR-\d+$/ })).toHaveCount(2);
});

test("3) a request that is still DRAFT offers no purchase actions at all", async ({ page, request }) => {
  const item = { name: `قلم پیش‌نویس ${uniqueSuffix()}`, quantity: 5 };
  const pr = await createPurchaseRequest(request, [item], { approve: false });

  await openRequestDetail(page, pr.id, pr.requestNumber);
  await expect(requestHeader(page)).toContainText("پیش‌نویس");
  await expect(createFullPurchaseButton(page)).toBeDisabled();
  await expect(createFullPurchaseButton(page)).toHaveAttribute("title", "ابتدا درخواست را تأیید کنید");
  await expect(requestedItemRow(page, item.name).getByRole("button")).toHaveCount(0);
});
