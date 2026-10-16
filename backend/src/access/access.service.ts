import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import { clearSessionAccessCache } from '../auth/session-access';
import { PrismaService } from '../prisma/prisma.service';

export const PERMISSION_CATALOG = [
  { code: 'users.create', label: 'ایجاد کاربر', module: 'کاربران' },
  { code: 'users.disable', label: 'غیرفعال کردن کاربر', module: 'کاربران' },
  // Restoring a deleted record from the delete archive (admin panel).
  { code: 'records.restore', label: 'بازیابی سوابق حذف‌شده', module: 'کاربران' },
  // Backup of the whole system to a folder / flash drive, and restoring it (admin panel).
  // Company details printed on documents (settings page); ADMIN by default, grantable to any role.
  { code: 'company.manage', label: 'مدیریت مشخصات شرکت', module: 'کاربران' },
  // Document-number formats (prefix, year/fixed part, digits, next number); ADMIN by default.
  { code: 'numbering.manage', label: 'مدیریت قالب شماره‌گذاری اسناد', module: 'کاربران' },
  { code: 'backup.manage', label: 'پشتیبان‌گیری از سیستم', module: 'کاربران' },
  { code: 'backup.restore', label: 'بازیابی سیستم از پشتیبان', module: 'کاربران' },
  { code: 'suppliers.view', label: 'مشاهده تأمین‌کنندگان', module: 'تأمین‌کنندگان' },
  { code: 'suppliers.manage', label: 'مدیریت تأمین‌کنندگان', module: 'تأمین‌کنندگان' },
  { code: 'suppliers.delete', label: 'حذف تأمین‌کنندگان', module: 'تأمین‌کنندگان' },
  // Bank accounts and national/economic identifiers of suppliers; without it they are hidden.
  { code: 'suppliers.viewSensitive', label: 'مشاهده اطلاعات حساس تأمین‌کنندگان (کد ملی، حساب بانکی)', module: 'تأمین‌کنندگان' },
  { code: 'customers.view', label: 'مشاهده مشتریان', module: 'مشتریان' },
  { code: 'customers.manage', label: 'مدیریت مشتریان', module: 'مشتریان' },
  { code: 'customers.delete', label: 'حذف مشتریان', module: 'مشتریان' },
  // National/economic identifiers and bank accounts of customers; without it they are hidden.
  { code: 'customers.viewSensitive', label: 'مشاهده اطلاعات حساس مشتریان (کد ملی، حساب بانکی)', module: 'مشتریان' },
  // Editing a customer's credit/payment policy (CustomerFinancialProfile) —
  // deliberately separate from customers.manage (business decision 2026-10-06).
  { code: 'customers.finance', label: 'مدیریت اطلاعات مالی مشتریان', module: 'مشتریان' },
  // Moving a customer into or out of ARCHIVED status.
  { code: 'customers.archive', label: 'بایگانی مشتریان', module: 'مشتریان' },
  { code: 'employees.view', label: 'مشاهده کارکنان', module: 'کارکنان' },
  { code: 'employees.manage', label: 'مدیریت کارکنان', module: 'کارکنان' },
  { code: 'employees.delete', label: 'حذف کارکنان و دپارتمان‌ها', module: 'کارکنان' },
  { code: 'purchases.view', label: 'مشاهده خرید', module: 'خرید' },
  { code: 'purchases.manage', label: 'مدیریت خرید', module: 'خرید' },
  { code: 'purchases.edit', label: 'ویرایش خرید', module: 'خرید' },
  { code: 'purchases.delete', label: 'حذف خرید', module: 'خرید' },
  // Covers both Item and Item Category (one master-data domain).
  { code: 'items.view', label: 'مشاهده کالاها', module: 'کالاها' },
  { code: 'items.manage', label: 'مدیریت کالاها', module: 'کالاها' },
  { code: 'items.delete', label: 'حذف کالاها', module: 'کالاها' },
  { code: 'itemCategories.delete', label: 'حذف دسته‌بندی کالا', module: 'کالاها' },
  { code: 'units.delete', label: 'حذف واحدها', module: 'کالاها' },
  // Sales permission set (Sales batch 1, 2026-10-06) — all added at once so
  // the seed only changes once; most get their routes in later batches.
  // Separation of duties: no single role sells, delivers and collects.
  { code: 'sales.view', label: 'مشاهده فروش', module: 'فروش' },
  { code: 'sales.manage', label: 'مدیریت فروش', module: 'فروش' },
  { code: 'sales.edit', label: 'ویرایش فروش', module: 'فروش' },
  { code: 'sales.delete', label: 'حذف اسناد فروش', module: 'فروش' },
  { code: 'sales.approve', label: 'تأیید فروش', module: 'فروش' },
  { code: 'sales.deliver', label: 'تحویل کالا', module: 'فروش' },
  { code: 'sales.invoice', label: 'صدور فاکتور', module: 'فروش' },
  { code: 'receivables.view', label: 'مشاهده مطالبات', module: 'مطالبات' },
  { code: 'receivables.manage', label: 'مدیریت دریافت‌ها', module: 'مطالبات' },
  // Inventory: view = stock list + adjustment documents; adjust = create/
  // edit/post/submit/delete stock adjustment documents. approve = approve/
  // reject a PENDING_APPROVAL document (I2, B10/B20) — never granted to
  // WAREHOUSE, no self-approval either way (enforced in the service).
  { code: 'inventory.view', label: 'مشاهده موجودی', module: 'موجودی' },
  { code: 'inventory.adjust', label: 'اصلاح موجودی', module: 'موجودی' },
  { code: 'inventory.approve', label: 'تأیید اسناد موجودی', module: 'موجودی' },
  { code: 'inventory.delete', label: 'حذف اسناد موجودی', module: 'موجودی' },
  // I3: locations, stock levels (min/reorder/max), item inventory settings,
  // batch correction — admin-level inventory configuration, never granted to
  // WAREHOUSE or SALES_MANAGER. Also now gates GET /inventory/integrity
  // (moved here from inventory.adjust, which was only a stand-in).
  { code: 'inventory.manage', label: 'تنظیمات موجودی', module: 'موجودی' },
  // I5: create/edit/post goods receipts (raw materials/packaging from
  // suppliers), QC release, and production output — every inbound stock
  // document (and goods returns, I8).
  { code: 'inventory.receive', label: 'رسید و برگشت کالا', module: 'موجودی' },
  // I5 (B15): see and enter unit costs on receipts/production output (and
  // valuation, I9). Never granted to Sales roles.
  { code: 'inventory.cost', label: 'مشاهده بهای موجودی', module: 'موجودی' },
  // I6 (B13 — adopted the architect's default, not yet confirmed by the
  // business owner): create/start/enter/submit/cancel a stock count (blind
  // entry while COUNTING). Approving a count's variances (REVIEW → POSTED)
  // and requesting a recount use inventory.approve instead — same
  // separation of duties as adjustments (B10), no self-approval.
  { code: 'inventory.count', label: 'شمارش موجودی', module: 'موجودی' },
  // Internal correspondence (نامه‌نگاری): every role holds it — letters are
  // between any two system users; visibility is per letter, not per permission.
  { code: 'letters.use', label: 'نامه‌نگاری', module: 'نامه‌ها' },
  // Management oversight: read-only access to every SENT letter (never drafts); each view is audited.
  { code: 'letters.readAll', label: 'مشاهدهٔ همهٔ نامه‌ها (نظارت مدیریتی)', module: 'نامه‌ها' },
  // Workflow engine (موتور گردش کار): rule definition is ADMIN only; the inbox is open to every role — who may APPROVE a document comes from the rule, not a permission.
  { code: 'workflow.manage', label: 'تعریف قوانین گردش کار و تأیید', module: 'گردش کار' },
  { code: 'workflow.inbox', label: 'کارتابل تأییدها', module: 'گردش کار' },
  { code: 'documents.upload', label: 'بارگذاری اسناد', module: 'اسناد' },
  { code: 'reports.view', label: 'مشاهده گزارش‌ها', module: 'گزارش‌ها' },
] as const;

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async createRole(name: string, permissionCodes: string[], actorId: number | null = null, ipAddress?: string) {
    const existing = await this.prisma.role.findUnique({ where: { name } });
    if (existing) throw new ConflictException('این نقش قبلاً وجود دارد');
    const permissions = await this.findPermissions(permissionCodes);
    const role = await this.prisma.role.create({
      data: {
        name,
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.audit.log({ userId: actorId, action: 'ROLE_CREATED', entityType: AUDIT_ENTITY.ROLE, entityId: role.id, details: `${name} · ${permissions.length} دسترسی`, ipAddress });
    return role;
  }

  async updateRole(id: number, permissionCodes: string[], actorId: number | null = null, ipAddress?: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('نقش پیدا نشد');
    const permissions = await this.findPermissions(permissionCodes);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      return tx.role.update({
        where: { id },
        data: { permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } },
        include: { permissions: { include: { permission: true } } },
      });
    });
    clearSessionAccessCache(); // every holder of the role gets the new permissions on their next request
    await this.audit.log({ userId: actorId, action: 'ROLE_PERMISSIONS_UPDATED', entityType: AUDIT_ENTITY.ROLE, entityId: id, details: `${role.name} · ${permissions.length} دسترسی`, ipAddress });
    return updated;
  }

  // Admin-only (controller). The ADMIN role itself is never deletable, and a role
  // still assigned to users or named as an approver in a workflow rule is refused —
  // move those first. Role-permission rows go with the role.
  async deleteRole(id: number, actorId: number | null = null, ipAddress?: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw new NotFoundException('نقش پیدا نشد');
    if (role.name === 'ADMIN') throw new ConflictException('نقش مدیر سیستم قابل حذف نیست');
    const userCount = await this.prisma.user.count({ where: { roleId: id } });
    if (userCount > 0) throw new ConflictException(`این نقش به ${userCount} کاربر داده شده است؛ ابتدا نقش آن کاربران را تغییر دهید`);
    const [ruleSteps, ruleApprovers, activeSteps] = await Promise.all([
      this.prisma.workflowRuleStep.count({ where: { roleId: id } }),
      this.prisma.workflowRuleStepApprover.count({ where: { roleId: id } }),
      this.prisma.approvalStepApprover.count({ where: { roleId: id } }),
    ]);
    if (ruleSteps + ruleApprovers + activeSteps > 0) {
      throw new ConflictException('این نقش در قوانین یا درخواست‌های گردش کار به‌عنوان تأییدکننده استفاده شده است و قابل حذف نیست');
    }
    const permissionCodes = role.permissions.map(({ permission }) => permission.name);
    try {
      await this.prisma.$transaction(async (tx) => {
        await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.ROLE, entityId: id, label: role.name, record: { id: role.id, name: role.name, permissionCodes }, userId: actorId });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.role.delete({ where: { id } });
      });
    } catch (error) {
      // A user or workflow rule picked this role after the checks above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('این نقش هم‌اکنون در حال استفاده است و قابل حذف نیست');
      }
      throw error;
    }
    await this.audit.log({ userId: actorId, action: 'ROLE_DELETED', entityType: AUDIT_ENTITY.ROLE, entityId: id, details: `${role.name} · ${permissionCodes.length} دسترسی`, ipAddress });
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

  async setUserPermissions(userId: number, permissionCodes: string[], actorId: number | null = null, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const permissions = await this.findPermissions(permissionCodes);
    await this.prisma.userPermission.deleteMany({ where: { userId } });
    await this.prisma.userPermission.createMany({ data: permissions.map((permission) => ({ userId, permissionId: permission.id })) });
    clearSessionAccessCache();
    await this.audit.log({ userId: actorId, action: 'USER_PERMISSIONS_UPDATED', entityType: AUDIT_ENTITY.USER, entityId: userId, details: `${user.username} · ${permissions.length} دسترسی اضافی`, ipAddress });
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
