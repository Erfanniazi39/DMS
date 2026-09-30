import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------
// Four tests, as requested: one add-success, one add-error, one
// edit-success, one edit-error. Each test creates whatever employee data
// it needs itself (rather than depending on another test having run
// first), so they can be run individually or in any order and still pass.
//
// These drive the real app against the real backend/database — nothing is
// mocked — so the backend and frontend dev servers need to be reachable
// (playwright.config.ts starts them itself if they aren't already running).
// ---------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

// --- unique test data -----------------------------------------------

// nationalId must be unique and code is auto-generated, so every test run
// needs fresh numbers — otherwise a second run would collide with rows
// left over from the first one.
function uniqueDigits(length: number): string {
  const source = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return source.slice(-length).padStart(length, "0");
}

function uniqueNationalId(): string {
  return uniqueDigits(10);
}

function uniqueMobilePhone(): string {
  return `09${uniqueDigits(9)}`;
}

type FormValues = {
  firstName: string;
  lastName: string;
  nationalId: string;
  mobilePhone: string;
  landlinePhone?: string;
  email?: string;
};

function validFixture(overrides: Partial<FormValues> = {}): FormValues {
  return {
    firstName: "علی",
    lastName: "رضایی",
    nationalId: uniqueNationalId(),
    mobilePhone: uniqueMobilePhone(),
    ...overrides,
  };
}

// --- page helpers ------------------------------------------------------

async function openEmployeesPage(page: Page) {
  await page.goto("/employees");
  await expect(page.getByRole("heading", { name: "کارکنان" })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  await page.getByRole("button", { name: "افزودن کارمند" }).click();
  await expect(page.getByRole("heading", { name: "افزودن کارمند جدید" })).toBeVisible();
  // Wait for the department list to actually arrive — selecting from it
  // before it loads would just re-select the disabled placeholder.
  await expect(page.locator("#employee-department option").nth(1)).toBeAttached();
}

async function selectFirstDepartment(page: Page) {
  const select = page.locator("#employee-department");
  const value = await select.locator("option").nth(1).getAttribute("value");
  if (!value) {
    throw new Error(
      "No department is seeded. Create at least one active department " +
        "(Master Data > Departments) before running the employees e2e tests.",
    );
  }
  await select.selectOption(value);
}

async function selectJalaliDate(
  page: Page,
  idPrefix: string,
  date: { year: number; month: number; day: number },
) {
  await page.locator(`#${idPrefix}-year`).selectOption(String(date.year));
  await page.locator(`#${idPrefix}-month`).selectOption(String(date.month));
  await page.locator(`#${idPrefix}-day`).selectOption(String(date.day));
}

// Fills every field the create/edit form exposes. birthDate/hireDate are
// always filled with the same two fixed, well-in-the-past dates — the exact
// values don't matter for these tests, only that they're present.
async function fillEmployeeForm(page: Page, values: FormValues) {
  await selectFirstDepartment(page);
  await page.locator("#employee-first-name").fill(values.firstName);
  await page.locator("#employee-last-name").fill(values.lastName);
  await page.locator("#employee-national-id").fill(values.nationalId);
  await page.locator("#employee-mobile-phone").fill(values.mobilePhone);
  if (values.landlinePhone !== undefined) {
    await page.locator("#employee-landline-phone").fill(values.landlinePhone);
  }
  if (values.email !== undefined) {
    await page.locator("#employee-email").fill(values.email);
  }
  await selectJalaliDate(page, "employee-birth-date", { year: 1370, month: 1, day: 1 });
  await selectJalaliDate(page, "employee-hire-date", { year: 1400, month: 1, day: 1 });
}

async function createEmployee(page: Page, values: FormValues) {
  await openCreateDialog(page);
  await fillEmployeeForm(page, values);
  await page.getByRole("button", { name: "ایجاد کارمند" }).click();
  // Toasts no longer get aria-hidden by a subsequent dialog, so two identical
  // "created" toasts from back-to-back creates can both be on screen at once.
  await expect(
    page.getByRole("status").filter({ hasText: "کارمند جدید با موفقیت ایجاد شد." }).last(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "افزودن کارمند جدید" })).toBeHidden();
}

async function searchFor(page: Page, query: string) {
  await page.getByPlaceholder("جستجو بر اساس نام، کد، کد ملی یا شماره تماس").fill(query);
}

async function getSingleRow(page: Page) {
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  return rows.first();
}

async function openEditFor(page: Page, nationalId: string) {
  await searchFor(page, nationalId);
  const row = await getSingleRow(page);
  await row.getByRole("button", { name: "ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش کارمند" })).toBeVisible();
}

// --- tests ---------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await openEmployeesPage(page);
});

test("1) adding an employee with valid data succeeds", async ({ page }) => {
  const data = validFixture();
  await createEmployee(page, data);

  await searchFor(page, data.nationalId);
  const row = await getSingleRow(page);
  await expect(row).toContainText(data.firstName);
  await expect(row).toContainText(data.lastName);
  // The code column must show a server-generated "<DEPT_CODE>-####" value —
  // there's no code field in the form any more (see employees.service.ts).
  await expect(row.locator("td").nth(1)).toHaveText(/^[A-Za-z0-9]+-\d{4}$/);
});

test("2) adding an employee with invalid field formats is rejected with specific messages", async ({
  page,
}) => {
  await openCreateDialog(page);
  // Department, name and dates are all valid/present. Only the format of these four fields is wrong, so each should surface
  // its own distinct toast rather than one generic error.
  await fillEmployeeForm(page, {
    firstName: "علی",
    lastName: "رضایی",
    nationalId: "12345", // must be exactly 10 digits
    mobilePhone: "12345", // must be exactly 11 digits
    landlinePhone: "123", // must be 6-11 digits
    email: "test@example", // must contain a dot after the @
  });
  await page.getByRole("button", { name: "ایجاد کارمند" }).click();

  for (const message of [
    "کد ملی باید دقیقاً ۱۰ رقم باشد.",
    "تلفن همراه باید دقیقاً ۱۱ رقم باشد.",
    "تلفن ثابت واردشده معتبر نیست.",
    "ایمیل واردشده معتبر نیست.",
  ]) {
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  }

  // Rejected client-side before any request was sent — the dialog is still
  // open with the form the user was editing.
  await expect(page.getByRole("heading", { name: "افزودن کارمند جدید" })).toBeVisible();
});

test("3) editing an employee's mobile phone succeeds", async ({ page }) => {
  const original = validFixture();
  await createEmployee(page, original);

  await openEditFor(page, original.nationalId);
  const newMobilePhone = uniqueMobilePhone();
  await page.locator("#employee-mobile-phone").fill(newMobilePhone);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "اطلاعات کارمند با موفقیت ویرایش شد." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "ویرایش کارمند" })).toBeHidden();

  // Confirm the new number was actually persisted server-side (this is the
  // exact scenario that used to fail with "Invalid input: expected object,
  // received string" — see the @UsePipes -> @Body(...) fix).
  await searchFor(page, original.nationalId);
  const row = await getSingleRow(page);
  await row.getByRole("button", { name: "نمایش جزئیات بیشتر" }).click();
  await expect(page.getByText(newMobilePhone)).toBeVisible();
});

test("4) editing an employee to reuse another employee's national ID is rejected", async ({
  page,
}) => {
  const employeeA = validFixture();
  await createEmployee(page, employeeA);

  const employeeB = validFixture();
  await createEmployee(page, employeeB);

  await openEditFor(page, employeeB.nationalId);
  await page.locator("#employee-national-id").fill(employeeA.nationalId);
  await page.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "این کد ملی قبلاً برای کارمند دیگری ثبت شده است" }),
  ).toBeVisible();
  // Rejected server-side (409 Conflict) — the dialog stays open, nothing
  // was saved.
  await expect(page.getByRole("heading", { name: "ویرایش کارمند" })).toBeVisible();

  await page.getByRole("button", { name: "انصراف" }).click();
  await searchFor(page, employeeA.nationalId);
  // Still exactly one employee has employeeA's national ID: employeeA.
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("5) submitting the empty create form shows the app's own Persian messages, reachable via role=alert while the dialog is open", async ({
  page,
}) => {
  await openCreateDialog(page);
  // Nothing filled in. The form is `noValidate`, so the browser's native
  // (English) constraint tooltip doesn't pre-empt validate(); and the toasts
  // it produces must stay in the accessibility tree even though a modal
  // @base-ui/react Dialog aria-hides everything outside its own portal
  // (ToastViewport is an always-mounted `aria-live` region, which Base UI
  // deliberately leaves exposed). getByRole() skips aria-hidden subtrees.
  await page.getByRole("button", { name: "ایجاد کارمند" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  for (const message of ["واحد سازمانی را انتخاب کنید.", "نام را وارد کنید.", "تاریخ تولد را مشخص کنید."]) {
    const alert = page.getByRole("alert").filter({ hasText: message });
    await expect(alert).toBeVisible();
    expect(await alert.evaluate((el) => el.closest('[aria-hidden="true"]') === null)).toBe(true);
  }
  await expect(page.getByRole("heading", { name: "افزودن کارمند جدید" })).toBeVisible();
});
