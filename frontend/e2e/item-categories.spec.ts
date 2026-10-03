import { test, expect, type Page } from "@playwright/test";

// Item Category (/item-categories) — same conventions as suppliers.spec.ts:
// serial execution, each test creates its own uniquely-coded data, and
// everything drives the real app/backend/database.

test.describe.configure({ mode: "serial" });

const BACKEND = "http://localhost:3001";

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

type FormValues = { code: string; nameEn: string; nameFa: string };

function validFixture(overrides: Partial<FormValues> = {}): FormValues {
  const suffix = uniqueSuffix();
  return { code: `cat_${suffix}`, nameEn: `Category ${suffix}`, nameFa: `دسته ${suffix}`, ...overrides };
}

async function openPage(page: Page) {
  await page.goto("/item-categories");
  await expect(page.getByRole("heading", { name: "دسته‌بندی کالاها", exact: true })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  await page.getByRole("button", { name: "افزودن دسته‌بندی" }).click();
  await expect(page.getByRole("heading", { name: "افزودن دسته‌بندی کالای جدید" })).toBeVisible();
}

async function fillForm(page: Page, values: Partial<FormValues>) {
  if (values.code !== undefined) await page.locator("#item-category-code").fill(values.code);
  if (values.nameFa !== undefined) await page.locator("#item-category-name-fa").fill(values.nameFa);
  if (values.nameEn !== undefined) await page.locator("#item-category-name-en").fill(values.nameEn);
}

async function createCategory(page: Page, values: FormValues) {
  await openCreateDialog(page);
  await fillForm(page, values);
  await page.getByRole("button", { name: "ایجاد دسته‌بندی" }).click();
  await expect(page.getByRole("status").filter({ hasText: "دسته‌بندی کالای جدید با موفقیت ایجاد شد." }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن دسته‌بندی کالای جدید" })).toBeHidden();
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("جستجو بر اساس نام یا کد").fill(query);
}

test.beforeEach(async ({ page }) => {
  await openPage(page);
});

test("1) the sidebar entries navigate to /items and /item-categories", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی" });
  await nav.getByRole("button", { name: "کالاها", exact: true }).click();
  await page.waitForURL(/\/items$/);
  await nav.getByRole("button", { name: "دسته‌بندی کالاها" }).click();
  await page.waitForURL(/\/item-categories$/);
});

test("2) adding a category with valid data succeeds and appears in the list", async ({ page }) => {
  const data = validFixture();
  await createCategory(page, data);

  await searchFor(page, data.code);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(data.nameFa);
  await expect(rows.first()).toContainText(data.nameEn);
  await expect(rows.first()).toContainText("فعال");
});

test("3) blank required fields are rejected client-side with a Persian message", async ({ page }) => {
  await openCreateDialog(page);
  await page.getByRole("button", { name: "ایجاد دسته‌بندی" }).click();
  // noValidate: the page's own check runs instead of a native browser tooltip.
  await expect(page.getByRole("alert").filter({ hasText: "کد، نام انگلیسی و نام فارسی دسته‌بندی الزامی است." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن دسته‌بندی کالای جدید" })).toBeVisible();
});

test("4) a duplicate code is rejected", async ({ page }) => {
  const original = validFixture();
  await createCategory(page, original);

  await openCreateDialog(page);
  await fillForm(page, { ...validFixture(), code: original.code });
  await page.getByRole("button", { name: "ایجاد دسته‌بندی" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "این کد قبلاً برای دسته‌بندی دیگری استفاده شده است" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن دسته‌بندی کالای جدید" })).toBeVisible();
});

test("5) a duplicate Persian name (different code) is rejected", async ({ page }) => {
  const original = validFixture();
  await createCategory(page, original);

  await openCreateDialog(page);
  await fillForm(page, { ...validFixture(), nameFa: original.nameFa });
  await page.getByRole("button", { name: "ایجاد دسته‌بندی" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "دسته‌بندی با این نام فارسی از قبل وجود دارد" })).toBeVisible();
});

test("6) deactivating a category keeps it on this page but hides it from the active-only dropdown list", async ({ page }) => {
  const data = validFixture();
  await createCategory(page, data);

  await searchFor(page, data.code);
  await page.locator("tbody tr").first().getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش دسته‌بندی کالا" })).toBeVisible();
  await page.locator("#item-category-is-active").uncheck();
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("status").filter({ hasText: "دسته‌بندی کالا با موفقیت ویرایش شد." })).toBeVisible();

  await page.locator("#item-category-status-filter").selectOption("inactive");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("غیرفعال");

  const active = (await (await page.request.get(`${BACKEND}/item-categories`)).json()) as Array<{ code: string }>;
  expect(active.some((category) => category.code === data.code)).toBe(false);
  const all = (await (await page.request.get(`${BACKEND}/item-categories/all`)).json()) as Array<{ code: string }>;
  expect(all.some((category) => category.code === data.code)).toBe(true);
});
