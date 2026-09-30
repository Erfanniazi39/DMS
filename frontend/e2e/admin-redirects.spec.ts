import { expect, test } from "@playwright/test";

// Purchases, Purchase Requests, Suppliers, Departments and Units moved out of
// "/admin/*" to top-level routes. The old paths are kept as thin redirect
// stubs so old bookmarks/links keep working — this checks they still land on
// the new location (including dynamic segments and the query string).
const cases: Array<{ from: string; to: RegExp }> = [
  { from: "/admin/purchases", to: /\/\/[^/]+\/purchases$/ },
  { from: "/admin/purchases/new?prefill=abc", to: /\/\/[^/]+\/purchases\/new\?prefill=abc$/ },
  { from: "/admin/purchases/123", to: /\/\/[^/]+\/purchases\/123$/ },
  { from: "/admin/purchases/123/edit", to: /\/\/[^/]+\/purchases\/123\/edit$/ },
  { from: "/admin/purchase-requests", to: /\/\/[^/]+\/purchase-requests$/ },
  { from: "/admin/purchase-requests/new", to: /\/\/[^/]+\/purchase-requests\/new$/ },
  { from: "/admin/purchase-requests/123", to: /\/\/[^/]+\/purchase-requests\/123$/ },
  { from: "/admin/purchase-requests/123/edit", to: /\/\/[^/]+\/purchase-requests\/123\/edit$/ },
  { from: "/admin/suppliers", to: /\/\/[^/]+\/suppliers$/ },
  { from: "/admin/departments", to: /\/\/[^/]+\/departments$/ },
  { from: "/admin/units", to: /\/\/[^/]+\/units$/ },
];

for (const { from, to } of cases) {
  test(`old ${from} redirects to its new top-level route`, async ({ page }) => {
    await page.goto(from);
    await page.waitForURL(to);
  });
}

test("moved pages still render inside the admin sidebar/header chrome", async ({ page }) => {
  await page.goto("/purchases");
  await expect(page.getByRole("navigation", { name: "ناوبری اصلی" })).toBeVisible();
  await expect(page.getByText("سامانه مدیریت کسب‌وکار")).toBeVisible();
});
