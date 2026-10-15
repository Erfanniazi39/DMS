import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { clearSessionAccessCache, revokeUserSessions } from '../auth/session-access';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const ADMIN_ROLE = 'ADMIN';

// USER is an independent account — it is never linked to, or used to
// create, an EMPLOYEE record. See database_plan.txt at the project root.
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateUserDto, actorId: number | null = null, ipAddress?: string) {
    const existingUsername = await this.prisma.user.findFirst({
      where: { username: { equals: dto.username, mode: 'insensitive' } },
    });
    if (existingUsername) {
      throw new ConflictException('این نام کاربری قبلاً استفاده شده است');
    }

    const role = await this.prisma.role.findUnique({ where: { name: dto.roleName } });
    if (!role) {
      throw new ConflictException('نقش انتخاب‌شده معتبر نیست');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        passwordHash,
        email: dto.email,
        phone: dto.phone,
        roleId: role.id,
        status: dto.status,
      },
      include: { role: true },
    });

    await this.audit.log({
      userId: actorId,
      action: 'USER_CREATED',
      entityType: AUDIT_ENTITY.USER,
      entityId: user.id,
      details: `${user.username} · ${user.role.name}`,
      ipAddress,
    });

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({
      include: { role: true },
      orderBy: { id: 'asc' },
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    }));
  }

  // Partial update — only the fields present in dto are changed.
  // Used by the "edit user" action: username, password, role, and
  // status (lock/disable) can each be changed independently.
  async update(id: number, dto: UpdateUserDto, actorId: number | null = null, ipAddress?: string, actorSessionId?: string) {
    const existing = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) {
      throw new NotFoundException('کاربر پیدا نشد');
    }

    // Usernames are case-insensitive; changing only the letter case of one's own name is allowed.
    if (dto.username && dto.username !== existing.username) {
      const usernameTaken = await this.prisma.user.findFirst({
        where: { username: { equals: dto.username, mode: 'insensitive' }, NOT: { id } },
      });
      if (usernameTaken) {
        throw new ConflictException('این نام کاربری قبلاً استفاده شده است');
      }
    }

    await this.assertAdminAccessRemains(existing, dto, actorId);

    let roleId: number | undefined;
    if (dto.roleName) {
      const role = await this.prisma.role.findUnique({ where: { name: dto.roleName } });
      if (!role) {
        throw new ConflictException('نقش انتخاب‌شده معتبر نیست');
      }
      roleId = role.id;
    }

    const passwordHash = dto.password
      ? await argon2.hash(dto.password, { type: argon2.argon2id })
      : undefined;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        username: dto.username,
        fullName: dto.fullName,
        passwordHash,
        email: dto.email,
        phone: dto.phone,
        roleId,
        status: dto.status,
      },
      include: { role: true },
    });

    // Take effect immediately (security review H1): the guard re-reads the account on
    // the next request; a password change or a disabled/locked account also deletes the
    // user's stored sessions (an admin changing their OWN password keeps this session).
    clearSessionAccessCache();
    if (passwordHash || (dto.status !== undefined && dto.status !== 'ACTIVE')) {
      await revokeUserSessions(this.prisma, [id], actorId === id ? actorSessionId : undefined);
    }

    // Password is never recorded — only that it changed.
    const changes = diffChanges(
      { ...existing, role: existing.role.name, password: null },
      { ...user, role: user.role.name, password: passwordHash ? 'changed' : null },
      ['username', 'fullName', 'email', 'phone', 'role', 'status', 'password'],
      { masked: ['password'] },
    );
    if (changes.length > 0) {
      await this.audit.log({
        userId: actorId,
        action: 'USER_UPDATED',
        entityType: AUDIT_ENTITY.USER,
        entityId: user.id,
        details: user.username,
        changes,
        ipAddress,
      });
    }

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
    };
  }

  // Any account may be edited, including مدیر سیستم accounts. Two guards keep
  // the system administrable: an admin cannot switch off their own account,
  // and the last ACTIVE admin cannot be demoted, disabled or locked.
  private async assertAdminAccessRemains(existing: { id: number; status: string; role: { name: string } }, dto: UpdateUserDto, actorId: number | null) {
    const nextStatus = dto.status ?? existing.status;
    const nextRole = dto.roleName ?? existing.role.name;
    if (actorId !== null && actorId === existing.id && nextStatus !== 'ACTIVE') {
      throw new ConflictException('نمی‌توانید حساب کاربری خودتان را غیرفعال یا قفل کنید');
    }
    const isActiveAdminNow = existing.role.name === ADMIN_ROLE && existing.status === 'ACTIVE';
    const staysActiveAdmin = nextRole === ADMIN_ROLE && nextStatus === 'ACTIVE';
    if (isActiveAdminNow && !staysActiveAdmin) {
      const others = await this.prisma.user.count({ where: { id: { not: existing.id }, status: 'ACTIVE', role: { name: ADMIN_ROLE } } });
      if (others === 0) throw new ConflictException('حداقل یک مدیر سیستم فعال باید در سامانه باقی بماند');
    }
  }

  // One account's profile for the admin user-detail page. Account data only —
  // no Employee link (CLAUDE.md rule 1). Permissions are shown as role-granted
  // plus individually granted, read-only here.
  async get(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissions: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const rolePermissions = user.role.permissions.map(({ permission }) => permission.name);
    const additionalPermissions = user.permissions.map(({ permission }) => permission.name);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      rolePermissions,
      additionalPermissions,
    };
  }
}
