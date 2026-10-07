import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const PERMISSION_CATALOG = [
  { code: 'users.create', label: 'ایجاد کاربر', module: 'کاربران' },
  { code: 'users.disable', label: 'غیرفعال کردن کاربر', module: 'کاربران' },
  { code: 'suppliers.view', label: 'مشاهده تأمین‌کنندگان', module: 'تأمین‌کنندگان' },
  { code: 'suppliers.manage', label: 'مدیریت تأمین‌کنندگان', module: 'تأمین‌کنندگان' },
  { code: 'customers.view', label: 'مشاهده مشتریان', module: 'مشتریان' },
  { code: 'customers.manage', label: 'مدیریت مشتریان', module: 'مشتریان' },
  // Editing a customer's credit/payment policy (CustomerFinancialProfile) —
  // deliberately separate from customers.manage (business decision 2026-10-06).
  { code: 'customers.finance', label: 'مدیریت اطلاعات مالی مشتریان', module: 'مشتریان' },
  // Moving a customer into or out of ARCHIVED status.
  { code: 'customers.archive', label: 'بایگانی مشتریان', module: 'مشتریان' },
  { code: 'employees.view', label: 'مشاهده کارکنان', module: 'کارکنان' },
  { code: 'employees.manage', label: 'مدیریت کارکنان', module: 'کارکنان' },
  { code: 'purchases.view', label: 'مشاهده خرید', module: 'خرید' },
  { code: 'purchases.manage', label: 'مدیریت خرید', module: 'خرید' },
  { code: 'purchases.edit', label: 'ویرایش خرید', module: 'خرید' },
  // Covers both Item and Item Category (one master-data domain).
  { code: 'items.view', label: 'مشاهده کالاها', module: 'کالاها' },
  { code: 'items.manage', label: 'مدیریت کالاها', module: 'کالاها' },
  // Sales permission set (Sales batch 1, 2026-10-06) — all added at once so
  // the seed only changes once; most get their routes in later batches.
  // Separation of duties: no single role sells, delivers and collects.
  { code: 'sales.view', label: 'مشاهده فروش', module: 'فروش' },
  { code: 'sales.manage', label: 'مدیریت فروش', module: 'فروش' },
  { code: 'sales.edit', label: 'ویرایش فروش', module: 'فروش' },
  { code: 'sales.approve', label: 'تأیید فروش', module: 'فروش' },
  { code: 'sales.deliver', label: 'تحویل کالا', module: 'فروش' },
  { code: 'sales.invoice', label: 'صدور فاکتور', module: 'فروش' },
  { code: 'receivables.view', label: 'مشاهده مطالبات', module: 'مطالبات' },
  { code: 'receivables.manage', label: 'مدیریت دریافت‌ها', module: 'مطالبات' },
  // Inventory: view = stock list + adjustment documents; adjust = create/
  // edit/post/delete stock adjustment documents.
  { code: 'inventory.view', label: 'مشاهده موجودی', module: 'موجودی' },
  { code: 'inventory.adjust', label: 'اصلاح موجودی', module: 'موجودی' },
  { code: 'documents.upload', label: 'بارگذاری اسناد', module: 'اسناد' },
  { code: 'reports.view', label: 'مشاهده گزارش‌ها', module: 'گزارش‌ها' },
] as const;

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      userCount: role._count.users,
      permissions: role.permissions.map(({ permission }) => permission.name),
    }));
  }

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: { name: 'asc' },
    });
    return permissions.map((permission) => ({
      id: permission.id,
      code: permission.name,
      ...PERMISSION_CATALOG.find((item) => item.code === permission.name),
      roles: permission.roles.map(({ role }) => role.name),
    }));
  }

  async createRole(name: string, permissionCodes: string[]) {
    const existing = await this.prisma.role.findUnique({ where: { name } });
    if (existing) throw new ConflictException('این نقش قبلاً وجود دارد');
    const permissions = await this.findPermissions(permissionCodes);
    return this.prisma.role.create({
      data: {
        name,
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async updateRole(id: number, permissionCodes: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('نقش پیدا نشد');
    const permissions = await this.findPermissions(permissionCodes);
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      return tx.role.update({
        where: { id },
        data: { permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } },
        include: { permissions: { include: { permission: true } } },
      });
    });
  }

  // Users & Access is independent of Employee — a user is identified here
  // by its own account fields (username/email), never by employee/department.
  async listUserPermissions() {
    const users = await this.prisma.user.findMany({
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissions: { include: { permission: true } },
      },
      orderBy: { id: 'asc' },
    });
    return users.map((user) => {
      const rolePermissions = user.role.permissions.map(({ permission }) => permission.name);
      const additionalPermissions = user.permissions.map(({ permission }) => permission.name);
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role.name,
        rolePermissions,
        additionalPermissions,
        effectivePermissions: [...new Set([...rolePermissions, ...additionalPermissions])],
      };
    });
  }

  async setUserPermissions(userId: number, permissionCodes: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const permissions = await this.findPermissions(permissionCodes);
    await this.prisma.userPermission.deleteMany({ where: { userId } });
    await this.prisma.userPermission.createMany({ data: permissions.map((permission) => ({ userId, permissionId: permission.id })) });
    return this.listUserPermissions();
  }

  private async findPermissions(codes: string[]) {
    const allowedCodes = new Set(PERMISSION_CATALOG.map((permission) => permission.code));
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.some((code) => !allowedCodes.has(code as never))) {
      throw new ConflictException('دسترسی انتخاب‌شده در فهرست مجاز نیست');
    }
    return this.prisma.permission.findMany({ where: { name: { in: uniqueCodes } } });
  }
}
