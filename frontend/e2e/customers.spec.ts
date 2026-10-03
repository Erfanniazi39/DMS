import { test, expect, type Page } from "@playwright/test";

// Customers E2E — same conventions as suppliers.spec.ts: serial execution,
// each test creates its own data so tests can be run individually or in any
// order, and everything drives the real app/backend/database.

test.describe.configure({ mode: "serial" });

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

type FormValues = {
  code: string;
  name: string;
  customerType: "retail" | "wholesale" | "distributor" | "other";
  phone: string;
  email?: string;
};

function validFixture(overrides: Partial<FormValues> = {}): FormValues {
  const suffix = uniqueSuffix();
  return {
    code: `CUS-${suffix}`,
    name: `مشتری ${suffix}`,
    customerType: "retail",
    phone: "02112345678",
    ...overrides,
  };
}

async function openCustomersPage(page: Page) {
  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "مشتریان", exact: true })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  await page.getByRole("button", { name: "افزودن مشتری" }).click();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeVisible();
}

async function fillCustomerForm(page: Page, values: FormValues) {
  await page.locator("#customer-code").fill(values.code);
  await page.locator("#customer-name").fill(values.name);
  await page.locator("#customer-type").selectOption(values.customerType);
  await page.locator("#customer-phone").fill(values.phone);
  if (values.email !== undefined) await page.locator("#customer-email").fill(values.email);
}

async function createCustomer(page: Page, values: FormValues) {
  await openCreateDialog(page);
  await fillCustomerForm(page, values);
  await page.getByRole("button", { name: "ایجاد مشتری" }).click();
  await expect(page.getByRole("status").filter({ hasText: "مشتری جدید با موفقیت ایجاد شد." }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeHidden();
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
  await openCustomersPage(page);
});

test("1) adding a customer with valid data succeeds and appears in the list", async ({ page }) => {
  const data = validFixture({ customerType: "wholesale", email: "customer@example.com" });
  await createCustomer(page, data);

  await searchFor(page, data.code);
  const row = await getSingleRow(page);
  await expect(row).toContainText(data.name);
  await expect(row).toContainText(data.code);
  await expect(row).toContainText("عمده‌فروشی");
});

test("2) creating a customer with a duplicate code is rejected", async ({ page }) => {
  const original = validFixture();
  await createCustomer(page, original);

  await openCreateDialog(page);
  await fillCustomerForm(page, validFixture({ code: original.code }));
  await page.getByRole("button", { name: "ایجاد مشتری" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "کد مشتری قبلاً استفاده شده است" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeVisible();
  await page.getByRole("button", { name: "انصراف" }).click();

  await searchFor(page, original.code);
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("3) creating a customer with a duplicate name (different code) is rejected", async ({ page }) => {
  const original = validFixture();
  await createCustomer(page, original);

  await openCreateDialog(page);
  await fillCustomerForm(page, validFixture({ name: original.name }));
  await page.getByRole("button", { name: "ایجاد مشتری" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "این نام قبلاً برای مشتری دیگری استفاده شده است" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeVisible();
});

test("4) editing a customer's phone and type succeeds and persists", async ({ page }) => {
  const original = validFixture({ phone: "02100000000" });
  await createCustomer(page, original);

  await searchFor(page, original.code);
  const row = await getSingleRow(page);
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش مشتری" })).toBeVisible();

  const newPhone = "02198765432";
  await page.locator("#customer-phone").fill(newPhone);
  await page.locator("#customer-type").selectOption("distributor");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(page.getByRole("status").filter({ hasText: "اطلاعات مشتری با موفقیت ویرایش شد." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ویرایش مشتری" })).toBeHidden();

  await searchFor(page, original.code);
  const updatedRow = await getSingleRow(page);
  await expect(updatedRow).toContainText(newPhone);
  await expect(updatedRow).toContainText("توزیع‌کننده");
});

test("5) a badly formatted email is rejected with the app's own Persian message", async ({ page }) => {
  const data = validFixture({ email: "not-an-email" });
  await openCreateDialog(page);
  await fillCustomerForm(page, data);
  await page.getByRole("button", { name: "ایجاد مشتری" }).click();

  // The form is noValidate: the browser's native type="email" tooltip must
  // not block submission — the page's own check reports it.
  await expect(page.getByRole("alert").filter({ hasText: "ایمیل معتبر نیست." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeVisible();
  await page.getByRole("button", { name: "انصراف" }).click();

  await searchFor(page, data.code);
  await expect(page.locator("tbody tr").filter({ hasText: data.code })).toHaveCount(0);
});

test("6) submitting an empty form shows Persian required-field messages and saves nothing", async ({ page }) => {
  await openCreateDialog(page);
  await page.getByRole("button", { name: "ایجاد مشتری" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "کد مشتری الزامی است." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "نوع مشتری را انتخاب کنید." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "تلفن الزامی است." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن مشتری جدید" })).toBeVisible();
});

test("7) deleting a customer removes it from the list", async ({ page }) => {
  const data = validFixture();
  await createCustomer(page, data);

  await searchFor(page, data.code);
  const row = await getSingleRow(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "حذف" }).click();

  await expect(page.getByRole("status").filter({ hasText: `مشتری «${data.name}» حذف شد.` })).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: data.code })).toHaveCount(0);
});
