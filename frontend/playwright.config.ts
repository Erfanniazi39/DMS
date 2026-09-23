import { defineConfig, devices } from "@playwright/test";
import path from "path";

// Cookies saved here after the "setup" project logs in once, then reused by
// every real test project so each test doesn't have to log in itself. This
// file holds a live session cookie — it is git-ignored (see .gitignore) and
// must never be committed.
const authFile = path.join(__dirname, "e2e/.auth/admin.json");

export default defineConfig({
  testDir: "./e2e",
  // Every test talks to the same Postgres database (through the real
  // backend, not a mock), so tests must not run concurrently against it —
  // one worker, in file order, keeps results predictable and repeatable.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "fa-IR",
  },
  projects: [
    // Logs in once with the seeded admin account and stores the resulting
    // session cookie in authFile. See e2e/auth.setup.ts.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: authFile },
      dependencies: ["setup"],
    },
  ],
  // If the backend/frontend dev servers are already running (the normal
  // way you work on this project), Playwright reuses them as-is. If not,
  // it starts them itself for the duration of the test run.
  webServer: [
    {
      // Checked by TCP port only (not an HTTP URL): every real route needs
      // either a session or specific data to respond with 2xx, so a port
      // check is the only "is it up yet" probe that doesn't depend on that.
      command: "npm run start:dev",
      cwd: "../backend",
      port: 3001,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      port: 3000,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
