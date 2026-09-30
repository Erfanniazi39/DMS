import { test, expect, type Page } from "@playwright/test";

// Closes the "no E2E tests for Suppliers" coverage gap. Same conventions as
// employees.spec.ts: serial execution, each test creates its own data so
// tests can be run individually or in any order, and everything drives the
// real app/backend/database — nothing is mocked.

test.describe.configure({ mode: "serial" });

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

type FormValues = {
  code: string;
  name: string;
  phone?: string;
  email?: string;
};

function validFixture(overrides: Partial<FormValues> = {}): FormValues {
  const suffix = uniqueSuffix();
  return {
    code: `SUP-${suffix}`,
    name: `تأمین‌کننده ${suffix}`,
    ...overrides,
  };
}

async function openSuppliersPage(page: Page) {
  await page.goto("/admin/suppliers");
  await expect(page.getByRole("heading", { name: "تأمین‌کنندگان" })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  await page.getByRole("button", { name: "افزودن تأمین‌کننده" }).click();
  await expect(page.getByRole("heading", { name: "افزودن تأمین‌کننده جدید" })).toBeVisible();
}

async function fillSupplierForm(page: Page, values: FormValues) {
  await page.locator("#supplier-code").fill(values.code);
  await page.locator("#supplier-name").fill(values.name);
  if (values.phone !== undefined) await page.locator("#supplier-phone").fill(values.phone);
  if (values.email !== undefined) await page.locator("#supplier-email").fill(values.email);
}

async function createSupplier(page: Page, values: FormValues) {
  await openCreateDialog(page);
  await fillSupplierForm(page, values);
  await page.getByRole("button", { name: "ایجاد تأمین‌کننده" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تأمین‌کننده جدید با موفقیت ایجاد شد." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن تأمین‌کننده جدید" })).toBeHidden();
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("جستجو بر اساس نام، کد، تلفن یا ایمیل").fill(query);
}

async function getSingleRow(page: Page) {
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  return rows.first();
}

test.beforeEach(async ({ page }) => {
  await openSuppliersPage(page);
});

test("1) adding a supplier with valid data succeeds and appears in the list", async ({ page }) => {
  const data = validFixture({ phone: "02112345678", email: "supplier@example.com" });
  await createSupplier(page, data);

  await searchFor(page, data.code);
  const row = await getSingleRow(page);
  await expect(row).toContainText(data.name);
  await expect(row).toContainText(data.code);
});

test("2) creating a supplier with a duplicate code is rejected", async ({ page }) => {
  const original = validFixture();
  await createSupplier(page, original);

  await openCreateDialog(page);
  await fillSupplierForm(page, { code: original.code, name: `نام دیگر ${uniqueSuffix()}` });
  await page.getByRole("button", { name: "ایجاد تأمین‌کننده" }).click();

  // Regression test for the dialog-open accessibility defect: a modal
  // @base-ui/react Dialog aria-hides everything outside its own portal
  // except `[aria-live]` regions. getByRole() excludes aria-hidden
  // elements, so this only passes while ToastViewport stays an always-
  // mounted aria-live region that the dialog leaves exposed.
  await expect(page.getByRole("heading", { name: "افزودن تأمین‌کننده جدید" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "کد تأمین‌کننده قبلاً استفاده شده است" })).toBeVisible();
  // Rejected server-side (409) — the dialog stays open, nothing new was saved.
  await expect(page.getByRole("heading", { name: "افزودن تأمین‌کننده جدید" })).toBeVisible();
  await page.getByRole("button", { name: "انصراف" }).click();

  await searchFor(page, original.code);
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("3) creating a supplier with a duplicate name (different code) is rejected", async ({ page }) => {
  const original = validFixture();
  await createSupplier(page, original);

  await openCreateDialog(page);
  await fillSupplierForm(page, { code: `SUP-${uniqueSuffix()}`, name: original.name });
  await page.getByRole("button", { name: "ایجاد تأمین‌کننده" }).click();

  // See test 2's comment — the toast must stay in the accessibility tree
  // while the dialog is open.
  await expect(
    page.getByRole("alert").filter({ hasText: "این نام قبلاً برای تأمین‌کننده دیگری استفاده شده است" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن تأمین‌کننده جدید" })).toBeVisible();
});

test("4) editing a supplier's phone number succeeds and persists", async ({ page }) => {
  const original = validFixture({ phone: "02100000000" });
  await createSupplier(page, original);

  await searchFor(page, original.code);
  const row = await getSingleRow(page);
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش تأمین‌کننده" })).toBeVisible();

  const newPhone = "02198765432";
  await page.locator("#supplier-phone").fill(newPhone);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(page.getByRole("status").filter({ hasText: "اطلاعات تأمین‌کننده با موفقیت ویرایش شد." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ویرایش تأمین‌کننده" })).toBeHidden();

  await searchFor(page, original.code);
  const updatedRow = await getSingleRow(page);
  await expect(updatedRow).toContainText(newPhone);
});
