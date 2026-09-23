import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

type UserWithAccess = NonNullable<Awaited<ReturnType<AuthService['findUserWithAccess']>>>;

// Discriminated result so the controller can tell WHY a login failed —
// specifically to distinguish "account locked/disabled" from a plain
// wrong username/password, per the company's request that locked/disabled
// users see the real reason instead of a generic credentials error.
export type LoginAttemptResult =
  | { status: 'ok'; user: UserWithAccess }
  | { status: 'not_found' }
  | { status: 'invalid_password' }
  | { status: 'locked' }
  | { status: 'disabled' };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private findUserWithAccess(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissions: { include: { permission: true } },
      },
    });
  }

  async attemptLogin(username: string, password: string): Promise<LoginAttemptResult> {
    const user = await this.findUserWithAccess(username);
    if (!user) {
      return { status: 'not_found' };
    }

    if (user.status === 'LOCKED') {
      return { status: 'locked' };
    }
    if (user.status === 'DISABLED') {
      return { status: 'disabled' };
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      return { status: 'invalid_password' };
    }

    return { status: 'ok', user };
  }

  getPermissionNames(user: UserWithAccess) {
    return [...new Set([
      ...user.role.permissions.map(({ permission }) => permission.name),
      ...user.permissions.map(({ permission }) => permission.name),
    ])];
  }

  async recordLogin(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async writeAuditLog(userId: number | null, action: string, ipAddress?: string) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        ipAddress: ipAddress ?? undefined,
      },
    });
  }
}
