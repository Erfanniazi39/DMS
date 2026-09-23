import { test as setup } from "@playwright/test";
import path from "path";

// /employees sits behind the admin session guard (see admin/layout.tsx,
// which calls GET /auth/me and bounces to /login on failure), so every real
// test needs a logged-in session first. Logging in once here and saving the
// resulting cookie is much faster than repeating the login form in all four
// tests, and keeps each test file focused on the thing it's actually
// checking.
const authFile = path.join(__dirname, ".auth", "admin.json");

setup("log in as admin", async ({ page }) => {
  const username = process.env.E2E_ADMIN_USERNAME ?? "admin";
  const password = process.env.E2E_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "E2E_ADMIN_PASSWORD is not set.\n" +
        "Set it to the admin password your backend printed once when you ran " +
        "the Prisma seed (backend: npx prisma db seed) — it is never shown " +
        "again, so use whatever you saved from that run, e.g.:\n" +
        "  (PowerShell)  $env:E2E_ADMIN_PASSWORD=\"...\"; npx playwright test\n" +
        "  (cmd.exe)     set E2E_ADMIN_PASSWORD=... && npx playwright test",
    );
  }

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();

  // A successful login calls router.push("/") — waiting for the URL to
  // leave /login is a login-success signal that doesn't depend on knowing
  // what page "/" ends up rendering.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.context().storageState({ path: authFile });
});
