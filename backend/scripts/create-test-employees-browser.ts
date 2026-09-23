/**
 * Visually exercises the /employees page by driving a real, visible browser
 * window through the actual Add/Edit Employee popup — the same fields and
 * clicks a person would use. Same idea as create-test-users-browser.ts:
 *
 *   Phase 1 — add `addCount` employees (default 50) with randomized but
 *             valid Persian names, departments, national IDs, phone
 *             numbers and dates.
 *   Phase 2 — edit `editCount` (default 25) of the employees just created,
 *             changing each one's mobile phone number and confirming the
 *             save succeeds.
 *   Phase 3 — two deliberate error cases, to show on screen (and report in
 *             the console) that validation actually blocks bad data:
 *               - adding an employee with invalid field formats (short
 *                 national ID/phone, bad email, ...) — expects the four
 *                 specific Persian error toasts.
 *               - editing an employee to reuse another employee's national
 *                 ID — expects the "duplicate national ID" conflict toast.
 *
 * This drives the Edge browser already built into Windows 11 (via
 * Playwright's "channel" option) instead of Playwright's own bundled
 * Chromium, so there is nothing extra to download — same as
 * create-test-users-browser.ts. `playwright` is already a backend
 * devDependency.
 *
 * Requires, already running, before you start this script:
 *   - Docker/Postgres
 *   - Backend:  npm run start:dev
 *   - Frontend: npm run dev   (reachable at http://localhost:3000)
 *   - At least one active department (Master Data > Departments) — the
 *     seed script creates "مدیریت" (MGMT) by default.
 *
 * Usage (from the backend folder):
 *   npx ts-node scripts/create-test-employees-browser.ts <admin-username> <admin-password> [addCount] [editCount]
 *
 * addCount and editCount are optional and default to 50 and 25:
 *
 *   npx ts-node scripts/create-test-employees-browser.ts admin <password>
 *   npx ts-node scripts/create-test-employees-browser.ts admin <password> 20 10
 *
 * Optional environment variables:
 *   APP_URL  (default http://localhost:3000)
 *   SLOWMO   (default 150 — milliseconds Playwright pauses between actions
 *             so the browser is easy to actually watch; set to 0 to run
 *             at full speed)
 */

import { chromium, type Page } from 'playwright';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const SLOWMO = Number(process.env.SLOWMO ?? 150);

const FIRST_NAMES = [
  'علی', 'محمد', 'رضا', 'حسین', 'احمد', 'مهدی', 'امیر', 'سعید', 'محسن', 'بابک',
  'آرش', 'کیانوش', 'پیمان', 'فرهاد', 'دانیال', 'زهرا', 'فاطمه', 'مریم', 'سارا', 'نگین',
  'الهام', 'شیوا', 'پریسا', 'لیلا', 'نسرین',
];
const LAST_NAMES = [
  'رضایی', 'محمدی', 'احمدی', 'حسینی', 'کریمی', 'نوری', 'صادقی', 'اکبری', 'جعفری', 'موسوی',
  'رحیمی', 'قاسمی', 'یوسفی', 'شریفی', 'عزیزی', 'فرهادی', 'کاظمی', 'امینی', 'باقری', 'هاشمی',
];
const POSITIONS = [
  'کارشناس فروش', 'حسابدار', 'انباردار', 'کارشناس اداری', 'مدیر تولید',
  'تکنسین', 'منشی', 'کارشناس خرید', 'راننده', 'نگهبان',
];

const SEARCH_PLACEHOLDER = 'جستجو بر اساس نام، کد، کد ملی یا شماره تماس';

function randomOf<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Every run gets its own 6-digit salt, so national IDs/phone numbers from
// one run never collide with rows left over from an earlier run; the loop
// index keeps them unique from each other within the same run.
const RUN_SALT = Date.now().toString().slice(-6);

function nationalIdFor(i: number): string {
  return `${RUN_SALT}${String(i).padStart(4, '0')}`.slice(-10).padStart(10, '0');
}

function mobilePhoneFor(i: number): string {
  const suffix = `${RUN_SALT}${String(i).padStart(4, '0')}`.slice(-9);
  return `09${suffix}`;
}

function randomMobilePhone(): string {
  return `09${String(randomInt(100000000, 999999999))}`;
}

type CreatedEmployee = { nationalId: string; mobilePhone: string; firstName: string; lastName: string };
type StepResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

async function selectJalaliDate(page: Page, idPrefix: string, year: number, month: number, day: number) {
  await page.selectOption(`#${idPrefix}-year`, String(year));
  await page.selectOption(`#${idPrefix}-month`, String(month));
  await page.selectOption(`#${idPrefix}-day`, String(day));
}

async function getDepartmentValues(page: Page): Promise<string[]> {
  const values = await page.$$eval('#employee-department option', (options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter((value) => value !== ''),
  );
  if (values.length === 0) {
    throw new Error('No active departments found in the dropdown — create at least one first (Master Data > Departments).');
  }
  return values;
}

async function readFirstAlertText(page: Page): Promise<string | null> {
  return page.locator('[role="alert"]').first().textContent().catch(() => null);
}

async function createRandomEmployee(page: Page, index: number, departmentValues: string[]): Promise<StepResult<CreatedEmployee>> {
  await page.getByRole('button', { name: 'افزودن کارمند' }).click();
  await page.waitForSelector('text=افزودن کارمند جدید');

  const firstName = randomOf(FIRST_NAMES);
  const lastName = randomOf(LAST_NAMES);
  const nationalId = nationalIdFor(index);
  const mobilePhone = mobilePhoneFor(index);

  await page.selectOption('#employee-department', randomOf(departmentValues));
  await page.fill('#employee-first-name', firstName);
  await page.fill('#employee-last-name', lastName);
  await page.fill('#employee-national-id', nationalId);
  await page.fill('#employee-mobile-phone', mobilePhone);
  if (Math.random() < 0.6) {
    await page.fill('#employee-position', randomOf(POSITIONS));
  }
  // Birth date: 1345-1380. Hire date: 1396-1401. Days capped at 28 so every
  // month/year combination is valid without checking each month's length.
  await selectJalaliDate(page, 'employee-birth-date', randomInt(1345, 1380), randomInt(1, 12), randomInt(1, 28));
  await selectJalaliDate(page, 'employee-hire-date', randomInt(1396, 1401), randomInt(1, 12), randomInt(1, 28));

  await page.click('button:has-text("ایجاد کارمند")');

  const success = await page
    .waitForSelector('text=کارمند جدید با موفقیت ایجاد شد', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!success) {
    const reason = (await readFirstAlertText(page)) ?? 'no confirmation seen';
    await page.click('button:has-text("انصراف")').catch(() => undefined);
    return { ok: false, reason };
  }

  return { ok: true, nationalId, mobilePhone, firstName, lastName };
}

async function editEmployeeMobilePhone(page: Page, nationalId: string): Promise<StepResult<{ newMobilePhone: string }>> {
  await page.fill(`input[placeholder="${SEARCH_PLACEHOLDER}"]`, nationalId);
  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount !== 1) {
    return { ok: false, reason: `expected exactly 1 matching row, found ${rowCount}` };
  }

  await rows.first().locator('button:has-text("ویرایش")').click();
  await page.waitForSelector('text=ویرایش کارمند');

  const newMobilePhone = randomMobilePhone();
  await page.fill('#employee-mobile-phone', newMobilePhone);
  await page.click('button:has-text("ذخیره تغییرات")');

  const success = await page
    .waitForSelector('text=اطلاعات کارمند با موفقیت ویرایش شد', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!success) {
    const reason = (await readFirstAlertText(page)) ?? 'no confirmation seen';
    await page.click('button:has-text("انصراف")').catch(() => undefined);
    return { ok: false, reason };
  }

  return { ok: true, newMobilePhone };
}

type CheckResult = { name: string; ok: boolean; detail?: string };

async function checkInvalidFormatsAreRejected(page: Page, departmentValues: string[]): Promise<CheckResult> {
  await page.getByRole('button', { name: 'افزودن کارمند' }).click();
  await page.waitForSelector('text=افزودن کارمند جدید');

  await page.selectOption('#employee-department', randomOf(departmentValues));
  await page.fill('#employee-first-name', 'علی');
  await page.fill('#employee-last-name', 'رضایی');
  await page.fill('#employee-national-id', '12345'); // must be exactly 10 digits
  await page.fill('#employee-mobile-phone', '12345'); // must be exactly 11 digits
  await page.fill('#employee-landline-phone', '123'); // must be 6-11 digits
  await page.fill('#employee-email', 'test@example'); // must contain a dot after the @
  await selectJalaliDate(page, 'employee-birth-date', 1370, 1, 1);
  await selectJalaliDate(page, 'employee-hire-date', 1400, 1, 1);
  await page.click('button:has-text("ایجاد کارمند")');

  const expectedMessages = [
    'کد ملی باید دقیقاً ۱۰ رقم باشد',
    'تلفن همراه باید دقیقاً ۱۱ رقم باشد',
    'تلفن ثابت واردشده معتبر نیست',
    'ایمیل واردشده معتبر نیست',
  ];

  const seen = await Promise.all(
    expectedMessages.map((message) =>
      page
        .locator(`[role="alert"]:has-text("${message}")`)
        .first()
        .isVisible()
        .catch(() => false),
    ),
  );
  const missing = expectedMessages.filter((_, i) => !seen[i]);

  await page.click('button:has-text("انصراف")').catch(() => undefined);

  return {
    name: 'افزودن با فرمت نامعتبر رد می‌شود (add: invalid formats rejected)',
    ok: missing.length === 0,
    detail: missing.length > 0 ? `missing toast(s): ${missing.join(' | ')}` : undefined,
  };
}

async function checkDuplicateNationalIdIsRejected(page: Page, created: CreatedEmployee[]): Promise<CheckResult> {
  const name = 'ویرایش با کد ملی تکراری رد می‌شود (edit: duplicate national ID rejected)';
  if (created.length < 2) {
    return { name, ok: false, detail: 'not enough employees were created to test this (need at least 2)' };
  }

  const [first, second] = created;
  await page.fill(`input[placeholder="${SEARCH_PLACEHOLDER}"]`, second.nationalId);
  const row = page.locator('tbody tr').first();
  await row.locator('button:has-text("ویرایش")').click();
  await page.waitForSelector('text=ویرایش کارمند');

  await page.fill('#employee-national-id', first.nationalId);
  await page.click('button:has-text("ذخیره تغییرات")');

  const conflictSeen = await page
    .locator('[role="alert"]:has-text("این کد ملی قبلاً برای کارمند دیگری ثبت شده است")')
    .first()
    .isVisible()
    .catch(() => false);

  await page.click('button:has-text("انصراف")').catch(() => undefined);

  return { name, ok: conflictSeen, detail: conflictSeen ? undefined : 'conflict message was not shown' };
}

async function main() {
  const [, , adminUsername, adminPassword, addCountArg, editCountArg] = process.argv;
  if (!adminUsername || !adminPassword) {
    console.error(
      'Usage: npx ts-node scripts/create-test-employees-browser.ts <admin-username> <admin-password> [addCount] [editCount]',
    );
    process.exitCode = 1;
    return;
  }
  const addCount = addCountArg ? Number(addCountArg) : 50;
  const editCount = editCountArg ? Number(editCountArg) : 25;

  const browser = await chromium.launch({ channel: 'msedge', headless: false, slowMo: SLOWMO });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log(`Opening ${APP_URL} and logging in as "${adminUsername}"...`);
  await page.goto(`${APP_URL}/login`);
  await page.fill('#username', adminUsername);
  await page.fill('#password', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  console.log('Logged in.\n');

  await page.goto(`${APP_URL}/employees`);
  await page.waitForSelector('text=کارکنان');

  // Read the department list once (open the dialog, read it, close it)
  // so every employee below can be assigned a random real department.
  await page.getByRole('button', { name: 'افزودن کارمند' }).click();
  await page.waitForSelector('text=افزودن کارمند جدید');
  const departmentValues = await getDepartmentValues(page);
  await page.click('button:has-text("انصراف")');

  // --- Phase 1: add -------------------------------------------------
  console.log(`=== Phase 1: adding ${addCount} random employees ===\n`);
  const created: CreatedEmployee[] = [];
  let addOk = 0;
  let addFailed = 0;

  for (let i = 1; i <= addCount; i++) {
    const result = await createRandomEmployee(page, i, departmentValues);
    if (result.ok) {
      console.log(`  OK   ${i}/${addCount}  ${result.firstName} ${result.lastName}  (${result.nationalId})`);
      created.push(result);
      addOk++;
    } else {
      console.log(`  SKIP ${i}/${addCount}  - ${result.reason}`);
      addFailed++;
    }
  }
  console.log(`\nPhase 1 done: ${addOk} created, ${addFailed} failed.\n`);

  // --- Phase 2: edit --------------------------------------------------
  const toEdit = created.slice(0, editCount);
  console.log(`=== Phase 2: editing ${toEdit.length} of the employees just created ===\n`);
  let editOk = 0;
  let editFailed = 0;

  for (let i = 0; i < toEdit.length; i++) {
    const employee = toEdit[i];
    const result = await editEmployeeMobilePhone(page, employee.nationalId);
    if (result.ok) {
      console.log(`  OK   ${i + 1}/${toEdit.length}  ${employee.firstName} ${employee.lastName}  -> ${result.newMobilePhone}`);
      editOk++;
    } else {
      console.log(`  SKIP ${i + 1}/${toEdit.length}  ${employee.firstName} ${employee.lastName}  - ${result.reason}`);
      editFailed++;
    }
  }
  console.log(`\nPhase 2 done: ${editOk} edited, ${editFailed} failed.\n`);

  // --- Phase 3: deliberate error cases ---------------------------------
  console.log('=== Phase 3: error-case checks ===\n');
  const checks = [
    await checkInvalidFormatsAreRejected(page, departmentValues),
    await checkDuplicateNationalIdIsRejected(page, created),
  ];
  for (const check of checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }
  const checksOk = checks.filter((c) => c.ok).length;

  console.log('\n==============================================');
  console.log(` Add:          ${addOk}/${addCount} succeeded`);
  console.log(` Edit:         ${editOk}/${toEdit.length} succeeded`);
  console.log(` Error checks: ${checksOk}/${checks.length} behaved as expected`);
  console.log('==============================================\n');
  console.log('Closing the browser in 5 seconds...');
  await page.waitForTimeout(5000);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
