/**
 * Creates 50 test users (user001..user050) through the real running API —
 * the exact same POST /users path the Add User form uses — not a database
 * shortcut. This exercises the employee-independent user creation we just
 * fixed: no employeeId is sent, and nothing in the Employee table is
 * touched by this script.
 *
 * Safe to re-run: a username that already exists (e.g. from a previous
 * run) is reported and skipped, never overwritten. Existing users and all
 * Employee records are never modified.
 *
 * Usage (from the backend folder, with Docker/Postgres and the backend
 * dev server — `npm run start:dev` — already running):
 *
 *   npx ts-node scripts/create-test-users.ts <admin-username> <admin-password> [startIndex] [count]
 *
 * startIndex and count are optional and default to 1 and 50 — e.g. if
 * user001..user050 already exist, run with startIndex 51 to continue
 * from user051 instead of hitting conflicts:
 *
 *   npx ts-node scripts/create-test-users.ts admin <password> 51
 *
 * Optional overrides via environment variables:
 *   API_HOST (default 127.0.0.1)
 *   API_PORT (default 3001, matching backend/.env PORT)
 */

import * as http from 'node:http';

const API_HOST = process.env.API_HOST ?? '127.0.0.1';
const API_PORT = Number(process.env.API_PORT ?? 3001);
const TEST_PASSWORD = '123456789';
const ROLES = ['ADMIN', 'DATA_OPERATOR', 'PURCHASE_MANAGER', 'SALES_MANAGER', 'VIEWER'] as const;

type JsonResponse = { status: number; headers: http.IncomingHttpHeaders; json: unknown };

function request(path: string, method: string, body: unknown, cookie?: string): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: API_HOST,
        port: API_PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

async function login(username: string, password: string): Promise<string> {
  const response = await request('/auth/login', 'POST', { username, password });

  if (response.status !== 200) {
    throw new Error(`Login failed (${response.status}): ${JSON.stringify(response.json)}`);
  }

  const setCookie = response.headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Login succeeded but no session cookie was returned.');
  }
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

type CreateResult =
  | { username: string; role: string; ok: true }
  | { username: string; role: string; ok: false; status: number; message: string };

async function createUser(cookie: string, index: number): Promise<CreateResult> {
  const username = `user${pad(index)}`;
  const role = ROLES[(index - 1) % ROLES.length];
  const email = `${username}@example.com`;

  const response = await request(
    '/users',
    'POST',
    { username, password: TEST_PASSWORD, email, roleName: role },
    cookie,
  );

  if (response.status >= 200 && response.status < 300) {
    return { username, role, ok: true };
  }

  const body = response.json as { message?: string } | null;
  return {
    username,
    role,
    ok: false,
    status: response.status,
    message: body?.message ?? String(response.json ?? 'خطای نامشخص'),
  };
}

async function main() {
  const [, , adminUsername, adminPassword, startArg, countArg] = process.argv;
  if (!adminUsername || !adminPassword) {
    console.error('Usage: npx ts-node scripts/create-test-users.ts <admin-username> <admin-password> [startIndex] [count]');
    process.exitCode = 1;
    return;
  }
  const startIndex = startArg ? Number(startArg) : 1;
  const count = countArg ? Number(countArg) : 50;

  console.log(`Logging in as "${adminUsername}" at http://${API_HOST}:${API_PORT} ...`);
  const cookie = await login(adminUsername, adminPassword);
  console.log(`Logged in. Creating ${count} test users starting at user${pad(startIndex)} (password for all: ${TEST_PASSWORD})...\n`);

  const results: CreateResult[] = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    const result = await createUser(cookie, i);
    results.push(result);
    if (result.ok) {
      console.log(`  OK   ${result.username} (${result.role})`);
    } else {
      console.log(`  SKIP ${result.username} (${result.role}) - ${result.status}: ${result.message}`);
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  console.log('\n==============================================');
  console.log(` Done: ${succeeded} created, ${failed} skipped/failed`);
  console.log(` Password for all created users: ${TEST_PASSWORD}`);
  console.log('==============================================\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
