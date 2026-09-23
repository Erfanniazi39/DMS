/**
 * Visually creates 50 test users (user001..user050) by driving a real
 * browser window through the actual Add User page — the same fields and
 * click a person would use. Same end result as create-test-users.ts (real
 * users created through the real form and the real backend), but visible
 * instead of silent.
 *
 * This drives the Edge browser already built into Windows 11 (via
 * Playwright's "channel" option) instead of Playwright's own bundled
 * Chromium, so there is nothing extra to download.
 *
 * One-time setup (from the backend folder):
 *   npm install -D playwright
 *   (no `npx playwright install` needed — Edge is used directly)
 *
 * Requires, already running, before you start this script:
 *   - Docker/Postgres
 *   - Backend:  npm run start:dev
 *   - Frontend: npm run dev   (reachable at http://localhost:3000)
 *
 * Usage (from the backend folder):
 *   npx ts-node scripts/create-test-users-browser.ts <admin-username> <admin-password> [startIndex] [count]
 *
 * startIndex and count are optional and default to 1 and 50 — e.g. if
 * user001..user050 already exist, run with startIndex 51 to continue
 * from user051 instead of hitting conflicts:
 *
 *   npx ts-node scripts/create-test-users-browser.ts admin <password> 51
 */

import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const TEST_PASSWORD = '123456789';
const ROLES = ['ADMIN', 'DATA_OPERATOR', 'PURCHASE_MANAGER', 'SALES_MANAGER', 'VIEWER'] as const;

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

async function main() {
  const [, , adminUsername, adminPassword, startArg, countArg] = process.argv;
  if (!adminUsername || !adminPassword) {
    console.error('Usage: npx ts-node scripts/create-test-users-browser.ts <admin-username> <admin-password> [startIndex] [count]');
    process.exitCode = 1;
    return;
  }
  const startIndex = startArg ? Number(startArg) : 1;
  const count = countArg ? Number(countArg) : 50;

  const browser = await chromium.launch({ channel: 'msedge', headless: false, slowMo: 250 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  console.log(`Opening ${APP_URL} and logging in as "${adminUsername}"...`);
  await page.goto(`${APP_URL}/login`);
  await page.fill('#username', adminUsername);
  await page.fill('#password', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  console.log('Logged in.\n');

  await page.goto(`${APP_URL}/admin/add-users`);

  let succeeded = 0;
  let failed = 0;

  for (let i = startIndex; i < startIndex + count; i++) {
    const username = `user${pad(i)}`;
    const role = ROLES[(i - 1) % ROLES.length];
    const email = `${username}@example.com`;

    await page.fill('#username', username);
    await page.fill('#password', TEST_PASSWORD);
    await page.fill('#email', email);
    await page.selectOption('#roleName', role);
    await page.click('button[type="submit"]');

    const success = await page
      .waitForSelector('text=با موفقیت ایجاد شد', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (success) {
      console.log(`  OK   ${username} (${role})`);
      succeeded++;
    } else {
      const errorText = await page.locator('[role="alert"]').first().textContent().catch(() => null);
      console.log(`  SKIP ${username} (${role}) - ${errorText ?? 'no confirmation seen'}`);
      failed++;
    }
  }

  console.log('\n==============================================');
  console.log(` Done: ${succeeded} created, ${failed} skipped/failed`);
  console.log(` Password for all created users: ${TEST_PASSWORD}`);
  console.log('==============================================\n');
  console.log('Closing the browser in 3 seconds...');
  await page.waitForTimeout(3000);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
