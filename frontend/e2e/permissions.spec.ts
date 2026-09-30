import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "crypto";
import path from "path";

// Closes the "no E2E permission-denial coverage" gap. The guard logic itself
// (SessionAuthGuard / PermissionsGuard) is unit-tested in
// backend/src/auth/guards/*.spec.ts; these tests instead drive a real
// low-privilege user through the real browser + backend to prove the guards
// are actually wired onto representative routes, end to end.
//
// Test account: `e2e_qa_viewer` (role VIEWER — only `reports.view`). It is a
// dev-DB-only, test-only account, created on first run through the app's own
// POST /users endpoint (as the saved e2e admin session), never by editing any
// pre-existing row. Its password is NOT stored anywhere: every run generates
// a fresh random one and sets it on that same test account via PATCH /users/:id,
// so no credential ever lives in the repo.

test.describe.configure({ mode: "serial" });

// These tests must start logged OUT — the chromium project's default
// storageState is the admin session, which would defeat the whole point.
test.use({ storageState: { cookies: [], origins: [] } });

const BACKEND = "http://localhost:3001";
const ADMIN_STATE = path.join(__dirname, ".auth", "admin.json");
const VIEWER_USERNAME = "e2e_qa_viewer";
const FORBIDDEN_MESSAGE = "اجازه دسترسی به این بخش را ندارید";

let viewerPassword = "";
let admin: APIRequestContext;

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function ensureViewerAccount(adminApi: APIRequestContext): Promise<string> {
  const password = `Qa-${randomBytes(12).toString("hex")}`;
  const listResponse = await adminApi.get(`${BACKEND}/users`);
  if (!listResponse.ok()) {
    throw new Error(
      `Could not list users as the saved e2e admin session (${listResponse.status()}). ` +
        "Is e2e/.auth/admin.json still a valid ADMIN session?",
    );
  }
  const users = (await listResponse.json()) as Array<{ id: number; username: string }>;
  const existing = users.find((user) => user.username === VIEWER_USERNAME);

  const response = existing
    ? await adminApi.patch(`${BACKEND}/users/${existing.id}`, {
        data: { password, roleName: "VIEWER", status: "ACTIVE" },
      })
    : await adminApi.post(`${BACKEND}/users`, {
        data: { username: VIEWER_USERNAME, password, roleName: "VIEWER" },
      });
  if (!response.ok()) throw new Error(`Failed to prepare ${VIEWER_USERNAME}: ${response.status()} ${await response.text()}`);
  return password;
}

async function loginAsViewer(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill(VIEWER_USERNAME);
  await page.locator("#password").fill(viewerPassword);
  await page.getByRole("button", { name: "ورود" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeAll(async () => {
  admin = await playwrightRequest.newContext({ storageState: ADMIN_STATE });
  viewerPassword = await ensureViewerAccount(admin);
});

test.afterAll(async () => {
  await admin?.dispose();
});

test.beforeEach(async ({ page }) => {
  await loginAsViewer(page);
});

test("1) a VIEWER's session really carries no purchases/suppliers/users permissions, and the sidebar hides those areas", async ({ page }) => {
  // Sanity-check the premise first: if seeding ever gave VIEWER more
  // permissions, the denial assertions below would be meaningless.
  const me = await (await page.request.get(`${BACKEND}/auth/me`)).json();
  expect(me.username).toBe(VIEWER_USERNAME);
  expect(me.permissions).not.toContain("purchases.manage");
  expect(me.permissions).not.toContain("purchases.edit");
  expect(me.permissions).not.toContain("suppliers.manage");
  expect(me.permissions).not.toContain("users.create");
  expect(me.permissions).not.toContain("purchases.view");
  expect(me.permissions).not.toContain("suppliers.view");
  expect(me.permissions).not.toContain("employees.view");

  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "ناوبری اصلی" });
  await expect(nav.getByRole("button", { name: "داشبورد" })).toBeVisible();
  await expect(nav).not.toContainText("خرید");
  await expect(nav).not.toContainText("تأمین‌کنندگان");
  await expect(nav).not.toContainText("واحدها");
  await expect(nav).not.toContainText("کارکنان");
});

test("2) protected read/write/admin API routes return 403 (not data, not 2xx) for a logged-in VIEWER", async ({ page }) => {
  const api = page.request; // shares the VIEWER's session cookie

  const attempts: Array<{ label: string; send: () => Promise<{ status(): number; json(): Promise<unknown> }> }> = [
    // Reads — gated by purchases.view / suppliers.view / employees.view,
    // none of which VIEWER holds.
    { label: "GET /purchases", send: () => api.get(`${BACKEND}/purchases`) },
    { label: "GET /purchases/1", send: () => api.get(`${BACKEND}/purchases/1`) },
    { label: "GET /purchase-requests", send: () => api.get(`${BACKEND}/purchase-requests`) },
    { label: "GET /purchase-requests/1", send: () => api.get(`${BACKEND}/purchase-requests/1`) },
    { label: "GET /suppliers", send: () => api.get(`${BACKEND}/suppliers`) },
    { label: "GET /suppliers/1", send: () => api.get(`${BACKEND}/suppliers/1`) },
    { label: "GET /employees", send: () => api.get(`${BACKEND}/employees`) },
    { label: "GET /employees/1", send: () => api.get(`${BACKEND}/employees/1`) },
    // Writes / admin.
    { label: "POST /purchases", send: () => api.post(`${BACKEND}/purchases`, { data: {} }) },
    { label: "PATCH /purchases/1", send: () => api.patch(`${BACKEND}/purchases/1`, { data: {} }) },
    { label: "DELETE /purchases/999999", send: () => api.delete(`${BACKEND}/purchases/999999`) },
    { label: "POST /purchase-requests", send: () => api.post(`${BACKEND}/purchase-requests`, { data: {} }) },
    { label: "PATCH /purchase-requests/1", send: () => api.patch(`${BACKEND}/purchase-requests/1`, { data: {} }) },
    { label: "POST /suppliers", send: () => api.post(`${BACKEND}/suppliers`, { data: { code: "X", name: "X" } }) },
    { label: "GET /users", send: () => api.get(`${BACKEND}/users`) },
    { label: "GET /access/roles", send: () => api.get(`${BACKEND}/access/roles`) },
    { label: "GET /dashboard/purchases-summary", send: () => api.get(`${BACKEND}/dashboard/purchases-summary`) },
    { label: "GET /units/all", send: () => api.get(`${BACKEND}/units/all`) },
  ];

  for (const attempt of attempts) {
    const response = await attempt.send();
    // 403 specifically — a 400 (validation) would mean the guard let the
    // request through to the pipe/handler, and a 401 would mean the session
    // wasn't recognised at all; neither proves permission enforcement.
    expect(response.status(), attempt.label).toBe(403);
    const body = (await response.json()) as { message?: string };
    expect(body.message, attempt.label).toBe(FORBIDDEN_MESSAGE);
  }

  // Baseline: the same kind of call with no session at all is a 401, not a
  // 403 — i.e. the 403s above really are the permission layer speaking.
  const anonymous = await playwrightRequest.newContext();
  try {
    expect((await anonymous.post(`${BACKEND}/suppliers`, { data: {} })).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("3) a VIEWER deep-linking to purchases/suppliers/employees pages sees a no-access notice, no data and no write buttons", async ({ page }) => {
  // The sidebar hides these pages (test 1); deep-linking must not expose
  // them either. The pages now gate on the .view permission client-side,
  // and the backend refuses the reads (test 2) and writes regardless.
  const pages: Array<{ path: string; notice: string; hiddenButton: string }> = [
    { path: "/suppliers", notice: "اجازه دسترسی به تأمین‌کنندگان را ندارید.", hiddenButton: "افزودن تأمین‌کننده" },
    { path: "/purchases", notice: "اجازه دسترسی به خریدها را ندارید.", hiddenButton: "خرید جدید" },
    { path: "/purchase-requests", notice: "اجازه دسترسی به درخواست‌های خرید را ندارید.", hiddenButton: "ثبت درخواست خرید" },
    { path: "/employees", notice: "اجازه دسترسی به کارکنان را ندارید.", hiddenButton: "افزودن کارمند" },
  ];
  for (const target of pages) {
    await page.goto(target.path);
    await expect(page.getByText(target.notice), target.path).toBeVisible();
    await expect(page.getByRole("button", { name: target.hiddenButton }), target.path).toHaveCount(0);
  }
});

test("4) a VIEWER posting a supplier directly is refused and nothing is saved", async ({ page }) => {
  const code = `SUP-DENY-${uniqueSuffix()}`;
  const response = await page.request.post(`${BACKEND}/suppliers`, {
    data: { code, name: `تأمین‌کننده غیرمجاز ${code}` },
  });
  expect(response.status()).toBe(403);

  // Independently confirmed as admin: the supplier really does not exist.
  const suppliers = (await (await admin.get(`${BACKEND}/suppliers`)).json()) as Array<{ code: string }>;
  expect(suppliers.some((supplier) => supplier.code === code)).toBe(false);
});
