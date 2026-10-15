import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { enforceSessionAccess } from '../session-access';

// The whole system's "must be logged in" gate (session-based auth, not JWT).
// Beyond having a session it re-checks, per request, that the account is still
// active and refreshes the session's permissions (see session-access.ts) — a
// disabled or demoted user is cut off immediately, not at the end of the session.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.session?.userId) {
      throw new UnauthorizedException('ورود به سیستم الزامی است');
    }
    await enforceSessionAccess(this.prisma, req);
    return true;
  }
}
