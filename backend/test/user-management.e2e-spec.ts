import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import session = require('express-session');
import connectPgSimple = require('connect-pg-simple');
import { AppModule } from '../src/app.module';

type RoleName = 'ADMIN' | 'DATA_OPERATOR' | 'PURCHASE_MANAGER' | 'SALES_MANAGER' | 'VIEWER';
type StatusName = 'ACTIVE' | 'DISABLED' | 'LOCKED';

type TestRecord = {
  username: string;
  password: string;
  roleName: RoleName;
  status: StatusName;
  employee: {
    code: string;
    firstName: string;
    lastName: string;
    position: string;
    email: string;
    phone: string;
    departmentId: number;
  };
};

const departments = ['مدیریت', 'خرید', 'فروش', 'تولید', 'انبار', 'مالی', 'منابع انسانی', 'فنی', 'اداری'];
const firstNames = ['آرمان', 'بهزاد', 'پویان', 'ترانه', 'ثریا', 'جواد', 'حامد', 'داریوش', 'رها', 'سینا'];
const lastNames = ['آریا', 'بهرامی', 'پوریا', 'توانگر', 'دادگر', 'رستگار', 'سامانی', 'فرهمند', 'کاشانی', 'نیکنام'];
const positions = ['کارشناس ارشد', 'کارشناس', 'هماهنگ‌کننده', 'سرپرست', 'تحلیلگر'];
const roles: RoleName[] = [
  ...Array<RoleName>(2).fill('ADMIN'),
  ...Array<RoleName>(8).fill('DATA_OPERATOR'),
  ...Array<RoleName>(8).fill('PURCHASE_MANAGER'),
  ...Array<RoleName>(7).fill('SALES_MANAGER'),
  ...Array<RoleName>(25).fill('VIEWER'),
];
const statuses: StatusName[] = Array.from({ length: 50 }, (_, index) => {
  if ([3, 16, 29, 42].includes(index)) return 'LOCKED';
  if ([7, 12, 21, 30, 38, 47].includes(index)) return 'DISABLED';
  return 'ACTIVE';
});

function buildRecords(): TestRecord[] {
  return Array.from({ length: 50 }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return {
      username: `test.user${number}`,
      password: '12345678',
      roleName: roles[index],
      status: statuses[index],
      employee: {
        code: `TEST-EMP-${number}`,
        firstName: firstNames[index % firstNames.length],
        lastName: `${lastNames[Math.floor(index / firstNames.length)]}-${number}`,
        position: positions[index % positions.length],
        email: `test.user${number}@example.test`,
        phone: `0912${String(1000000 + index).padStart(7, '0')}`,
        departmentId: (index % departments.length) + 1,
      },
    };
  });
}

const testRecords = buildRecords();
const enabled = process.env.RUN_USER_MANAGEMENT_E2E === 'true';
const suite = enabled ? describe : describe.skip;

suite('User-management automated preparation', () => {
  let app: INestApplication<App>;
  let agent: ReturnType<typeof request.agent>;
  let sessionStore: { close?: () => Promise<void> };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    const PgSession = connectPgSimple(session);
    sessionStore = new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: 'user_sessions',
        createTableIfMissing: true,
      });
    app.use(session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
    }));
    await app.init();
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await sessionStore?.close?.();
  });

  it('preflights the application before creating any test records', async () => {
    const password = process.env.USER_MANAGEMENT_ADMIN_PASSWORD;
    if (!password) {
      throw new Error('Set USER_MANAGEMENT_ADMIN_PASSWORD before running this data-creating test.');
    }

    await agent.post('/auth/login').send({ username: 'admin', password }).expect(200);
    const [rolesResponse, usersResponse, departmentsResponse] = await Promise.all([
      agent.get('/access/roles').expect(200),
      agent.get('/users').expect(200),
      agent.get('/departments').expect(200),
    ]);

    const existingUsernames = new Set(usersResponse.body.map((user: { username: string }) => user.username));
    const collisions = testRecords.filter((record) => existingUsernames.has(record.username)).map((record) => record.username);
    expect(collisions).toEqual([]);

    const existingRoles = new Set(rolesResponse.body.map((role: { name: string }) => role.name));
    expect([...new Set(roles)].every((role) => existingRoles.has(role))).toBe(true);

    const existingDepartments = new Set(departmentsResponse.body.map((department: { name: string }) => department.name));
    const missingDepartments = departments.filter((department) => !existingDepartments.has(department));
    if (missingDepartments.length > 0) {
      throw new Error(`Test data creation stopped safely: missing departments: ${missingDepartments.join('، ')}`);
    }

    throw new Error(
      'Test data creation stopped safely: the application has no legitimate account-status lifecycle API. '
      + 'It cannot create DISABLED or LOCKED users through the application, so no records were created.',
    );
  });
});

export { buildRecords, departments, testRecords };
