import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Item (/items) — same conventions as suppliers.spec.ts: serial execution,
// each test creates its own uniquely-coded data, nothing is mocked. A
// dedicated Item Category is created once through the real API so the
// category dropdown/filter always has a known option to pick.

test.describe.configure({ mode: "serial" });

const BACKEND = "http://localhost:3001";

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

type Ref = { id: number; nameFa: string };
let category: Ref;
let unit: Ref;

async function createCategoryViaApi(api: APIRequestContext): Promise<Ref> {
  const suffix = uniqueSuffix();
  const response = await api.post(`${BACKEND}/item-categories`, {
    data: { code: `e2e_items_${suffix}`, nameEn: `E2E Items ${suffix}`, nameFa: `دسته آزمون ${suffix}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Ref;
}

type FormValues = { code: string; name: string };

function validFixture(overrides: Partial<FormValues> = {}): FormValues {
  const suffix = uniqueSuffix();
  return { code: `ITM-${suffix}`, name: `کالای ${suffix}`, ...overrides };
}

async function openItemsPage(page: Page) {
  await page.goto("/items");
  await expect(page.getByRole("heading", { name: "کالاها", exact: true })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  await page.getByRole("button", { name: "افزودن کالا" }).click();
  await expect(page.getByRole("heading", { name: "افزودن کالای جدید" })).toBeVisible();
}

async function fillItemForm(page: Page, values: FormValues) {
  await page.locator("#item-code").fill(values.code);
  await page.locator("#item-name").fill(values.name);
  await page.locator("#item-category").selectOption(String(category.id));
  await page.locator("#item-unit").selectOption(String(unit.id));
}

async function createItem(page: Page, values: FormValues) {
  await openCreateDialog(page);
  await fillItemForm(page, values);
  await page.getByRole("button", { name: "ایجاد کالا" }).click();
  await expect(page.getByRole("status").filter({ hasText: "کالای جدید با موفقیت ایجاد شد." }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن کالای جدید" })).toBeHidden();
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("جستجو بر اساس نام یا کد").fill(query);
}

async function getSingleRow(page: Page) {
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  return rows.first();
}

test.beforeAll(async ({ request }) => {
  category = await createCategoryViaApi(request);
  const units = (await (await request.get(`${BACKEND}/units`)).json()) as Ref[];
  expect(units.length).toBeGreaterThan(0);
  unit = units[0];
});

test.beforeEach(async ({ page }) => {
  await openItemsPage(page);
});

test("1) adding an item with category and unit succeeds and shows their labels in the list", async ({ page }) => {
  const data = validFixture();
  await createItem(page, data);

  await searchFor(page, data.code);
  const row = await getSingleRow(page);
  await expect(row).toContainText(data.name);
  await expect(row).toContainText(category.nameFa);
  await expect(row).toContainText(unit.nameFa);
  await expect(row).toContainText("فعال");
});

test("2) missing required fields and selects are rejected client-side with Persian messages", async ({ page }) => {
  await openCreateDialog(page);
  await page.getByRole("button", { name: "ایجاد کالا" }).click();
  // noValidate: the page's own checks run instead of native browser tooltips.
  for (const message of ["کد کالا الزامی است.", "نام کالا الزامی است.", "انتخاب دسته‌بندی الزامی است.", "انتخاب واحد الزامی است."]) {
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "افزودن کالای جدید" })).toBeVisible();
});

test("3) a duplicate code is rejected", async ({ page }) => {
  const original = validFixture();
  await createItem(page, original);

  await openCreateDialog(page);
  await fillItemForm(page, { code: original.code, name: `نام دیگر ${uniqueSuffix()}` });
  await page.getByRole("button", { name: "ایجاد کالا" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "کد کالا قبلاً استفاده شده است" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن کالای جدید" })).toBeVisible();
});

test("4) a duplicate name (different code) is rejected", async ({ page }) => {
  const original = validFixture();
  await createItem(page, original);

  await openCreateDialog(page);
  await fillItemForm(page, { code: `ITM-${uniqueSuffix()}`, name: original.name });
  await page.getByRole("button", { name: "ایجاد کالا" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "این نام قبلاً برای کالای دیگری استفاده شده است" })).toBeVisible();
});

test("5) editing an item's status and description persists", async ({ page }) => {
  const original = validFixture();
  await createItem(page, original);

  await searchFor(page, original.code);
  const row = await getSingleRow(page);
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش کالا" })).toBeVisible();
  await expect(page.locator("#item-category")).toHaveValue(String(category.id));
  await page.locator("#item-status").selectOption("inactive");
  await page.locator("#item-description").fill("توضیح آزمایشی");
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
  await expect(page.getByRole("status").filter({ hasText: "اطلاعات کالا با موفقیت ویرایش شد." })).toBeVisible();

  await page.locator("#item-status-filter").selectOption("inactive");
  const updatedRow = await getSingleRow(page);
  await expect(updatedRow).toContainText("غیرفعال");
  await updatedRow.click();
  await expect(page.getByText("توضیح آزمایشی")).toBeVisible();
});

test("6) deleting an item removes it from the list", async ({ page }) => {
  const data = validFixture();
  await createItem(page, data);
  await searchFor(page, data.code);
  const row = await getSingleRow(page);

  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "حذف" }).click();
  await expect(page.getByRole("status").filter({ hasText: `کالای «${data.name}» حذف شد.` })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("7) the list is paginated server-side (20 per page) and filters by category", async ({ page }) => {
  // A fresh category with exactly 21 items → two pages when filtered by it.
  const pagedCategory = await createCategoryViaApi(page.request);
  const suffix = uniqueSuffix();
  for (let index = 0; index < 21; index++) {
    const response = await page.request.post(`${BACKEND}/items`, {
      data: { code: `PG-${suffix}-${index}`, name: `کالای صفحه‌بندی ${suffix} ${String(index).padStart(2, "0")}`, categoryId: pagedCategory.id, unitId: unit.id },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  await page.reload();
  await page.locator("#item-category-filter").selectOption(String(pagedCategory.id));
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await expect(page.getByText("صفحه ۱ از ۲")).toBeVisible();

  await page.getByRole("button", { name: "صفحه بعد" }).click();
  await expect(page.getByText("صفحه ۲ از ۲")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
