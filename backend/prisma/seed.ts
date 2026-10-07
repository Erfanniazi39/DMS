import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

// SALESPERSON / WAREHOUSE / ACCOUNTANT added in Sales batch 1 (2026-10-06):
// separation of duties — no single person should sell, deliver, and collect.
const ROLES = ['ADMIN', 'DATA_OPERATOR', 'PURCHASE_MANAGER', 'SALES_MANAGER', 'VIEWER', 'SALESPERSON', 'WAREHOUSE', 'ACCOUNTANT'] as const;

// Single warehouse for now (business decision 2026-10-06) — the default
// InventoryLocation that stock adjustments post to when no location is given.
const DEFAULT_INVENTORY_LOCATION = { code: 'MAIN', name: 'انبار مرکزی' } as const;

// Purchase Type seed list — exact codes from database_plan.txt.
const PURCHASE_TYPES = [
  { code: 'raw_material', nameEn: 'Raw Material', nameFa: 'مواد اولیه' },
  { code: 'food_ingredient', nameEn: 'Food Ingredient', nameFa: 'مواد غذایی' },
  { code: 'packaging', nameEn: 'Packaging', nameFa: 'بسته‌بندی' },
  { code: 'machinery', nameEn: 'Machinery', nameFa: 'ماشین‌آلات' },
  { code: 'spare_parts', nameEn: 'Spare Parts', nameFa: 'قطعات یدکی' },
  { code: 'tools', nameEn: 'Tools', nameFa: 'ابزار' },
  { code: 'accessories', nameEn: 'Accessories', nameFa: 'لوازم جانبی' },
  { code: 'transportation', nameEn: 'Transportation', nameFa: 'حمل و نقل' },
  { code: 'office_supplies', nameEn: 'Office Supplies', nameFa: 'لوازم اداری' },
  { code: 'maintenance', nameEn: 'Maintenance', nameFa: 'تعمیر و نگهداری' },
  { code: 'other', nameEn: 'Other', nameFa: 'سایر' },
] as const;

// Unit is Master Data shared by Purchase Item (database_plan.txt gives "kg",
// "liter" as examples only, not a full list) — added manually here rather
// than through a UI "add unit" feature, by explicit instruction. Adjust
// this list directly and rerun the seed (upserts are idempotent) whenever
// another unit is needed.
const UNITS = [
  { code: 'pcs', nameEn: 'Piece', nameFa: 'عدد' },
  { code: 'count', nameEn: 'Count', nameFa: 'تعداد' },
  { code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم' },
  { code: 'g', nameEn: 'Gram', nameFa: 'گرم' },
  { code: 'ton', nameEn: 'Ton', nameFa: 'تن' },
  { code: 'liter', nameEn: 'Liter', nameFa: 'لیتر' },
  { code: 'ml', nameEn: 'Milliliter', nameFa: 'میلی‌لیتر' },
  { code: 'carton', nameEn: 'Carton', nameFa: 'کارتن' },
  { code: 'package', nameEn: 'Package', nameFa: 'بسته' },
  { code: 'box', nameEn: 'Box', nameFa: 'جعبه' },
  { code: 'bag', nameEn: 'Bag', nameFa: 'کیسه' },
  { code: 'bottle', nameEn: 'Bottle', nameFa: 'بطری' },
  { code: 'can', nameEn: 'Can', nameFa: 'قوطی' },
  { code: 'roll', nameEn: 'Roll', nameFa: 'رول' },
  { code: 'pallet', nameEn: 'Pallet', nameFa: 'پالت' },
  { code: 'dozen', nameEn: 'Dozen', nameFa: 'دوجین' },
  { code: 'pair', nameEn: 'Pair', nameFa: 'جفت' },
  { code: 'meter', nameEn: 'Meter', nameFa: 'متر' },
] as const;

// Catch-all supplier for a purchase whose actual supplier isn't in the
// system yet — picking it on the Purchase form avoids blocking data entry
// on creating a full Supplier record right away. Not a placeholder for
// "unknown data": Note on the purchase can record who the real supplier
// was, and the purchase can be re-pointed at a proper Supplier later.
const OTHER_SUPPLIER = { code: 'OTHER', name: 'سایر' } as const;

const PERMISSIONS = [
  'users.create',
  'users.disable',
  'suppliers.view',
  'suppliers.manage',
  'customers.view',
  'customers.manage',
  // Customer credit/payment policy and archive/unarchive (2026-10-06).
  // Granted to ADMIN only (via PERMISSIONS below) — which other roles get
  // them is a business decision not yet made.
  'customers.finance',
  'customers.archive',
  'employees.view',
  'employees.manage',
  'purchases.view',
  'purchases.manage',
  'purchases.edit',
  // Item + Item Category master data (one permission pair for both).
  'items.view',
  'items.manage',
  // Sales / receivables / inventory set (Sales batch 1, 2026-10-06) — keep
  // in sync with PERMISSION_CATALOG in src/access/access.service.ts.
  'sales.view',
  'sales.manage',
  'sales.edit',
  'sales.approve',
  'sales.deliver',
  'sales.invoice',
  'receivables.view',
  'receivables.manage',
  'inventory.view',
  'inventory.adjust',
  'documents.upload',
  'reports.view',
] as const;

function generatePassword(length = 16): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}

async function main() {
  for (const name of ROLES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const name of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const rolePermissions = {
    ADMIN: PERMISSIONS,
    // Sales narrowed to sales.view only (business decision 2026-10-06,
    // separation of duties) — sales.manage/sales.edit are revoked below.
    DATA_OPERATOR: ['suppliers.view', 'suppliers.manage', 'customers.view', 'customers.manage', 'employees.view', 'employees.manage', 'purchases.view', 'purchases.manage', 'purchases.edit', 'items.view', 'items.manage', 'sales.view', 'documents.upload', 'reports.view'],
    // employees.view (without employees.manage) is deliberate: the Purchase and
    // Purchase Request forms load GET /employees for buyer/requester dropdowns.
    PURCHASE_MANAGER: ['suppliers.view', 'suppliers.manage', 'employees.view', 'purchases.view', 'purchases.manage', 'purchases.edit', 'documents.upload', 'reports.view'],
    // items.* granted ahead of Sales: SalesItem will reference Item.
    // customers.* granted ahead of Sales too: Customer is sales-side master data.
    // Sales batch 1: + sales.view/approve/invoice, receivables.view,
    // inventory.view. NOT receivables.manage — a manager sees money owed but
    // doesn't record/allocate payments (separation of duties).
    SALES_MANAGER: ['customers.view', 'customers.manage', 'items.view', 'items.manage', 'sales.view', 'sales.manage', 'sales.edit', 'sales.approve', 'sales.invoice', 'receivables.view', 'inventory.view', 'documents.upload', 'reports.view'],
    VIEWER: ['reports.view'],
    // New roles, Sales batch 1 (2026-10-06).
    SALESPERSON: ['sales.view', 'sales.manage', 'customers.view', 'items.view', 'inventory.view'],
    WAREHOUSE: ['sales.view', 'sales.deliver', 'inventory.view', 'inventory.adjust'],
    ACCOUNTANT: ['sales.view', 'sales.invoice', 'receivables.view', 'receivables.manage', 'customers.finance'],
  } as const;

  // The grants above are upserted (additive) — that alone can never take a
  // permission away from a role on an existing database. Explicit, targeted
  // revocations go here instead. Deliberately NOT a full "sync role to this
  // list": that would also wipe any grant an admin added through the
  // roles UI. Per-user extra grants (user_permissions) are not touched.
  const revokedRolePermissions: Record<string, readonly string[]> = {
    // Business decision 2026-10-06: DATA_OPERATOR keeps sales.view only.
    DATA_OPERATOR: ['sales.manage', 'sales.edit'],
  };

  const allPermissions = await prisma.permission.findMany();

  for (const [roleName, permissionNames] of Object.entries(rolePermissions)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    for (const permissionName of permissionNames) {
      const permission = allPermissions.find(({ name }) => name === permissionName);
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  for (const [roleName, permissionNames] of Object.entries(revokedRolePermissions)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const permissionIds = allPermissions.filter(({ name }) => permissionNames.includes(name)).map(({ id }) => id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: permissionIds } } });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });

  // Starter department so Employee records (Master Data) can be created
  // right after setup. Rename or add more via Master Data > Departments.
  // Departments belong to Employee only — never to User.
  await prisma.department.upsert({
    where: { code: 'MGMT' },
    update: {},
    create: {
      code: 'MGMT',
      name: 'مدیریت',
      status: 'active',
    },
  });

  for (const [index, purchaseType] of PURCHASE_TYPES.entries()) {
    await prisma.purchaseType.upsert({
      where: { code: purchaseType.code },
      update: {},
      create: { ...purchaseType, sortOrder: index },
    });
  }

  for (const [index, unit] of UNITS.entries()) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: {},
      create: { ...unit, sortOrder: index },
    });
  }

  await prisma.supplier.upsert({
    where: { code: OTHER_SUPPLIER.code },
    update: {},
    create: { ...OTHER_SUPPLIER, status: 'active' },
  });

  await prisma.inventoryLocation.upsert({
    where: { code: DEFAULT_INVENTORY_LOCATION.code },
    update: {},
    create: { ...DEFAULT_INVENTORY_LOCATION, isActive: true, isDefault: true },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });

  if (existingAdmin) {
    console.log('Admin user already exists — skipping admin creation.');
    return;
  }

  // USER is created independently — no Employee record is created or
  // referenced here. See database_plan.txt at the project root.
  const plainPassword = generatePassword();
  const passwordHash = await argon2.hash(plainPassword, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      roleId: adminRole.id,
      status: 'ACTIVE',
    },
  });

  console.log('\n==============================================');
  console.log(' Admin account created');
  console.log(' Username: admin');
  console.log(` Password: ${plainPassword}`);
  console.log(' Save this password now — it will not be shown again.');
  console.log('==============================================\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
