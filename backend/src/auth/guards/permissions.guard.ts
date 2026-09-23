import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const userPermissions = req.session?.permissions ?? [];
    const hasAll = required.every((permission) =>
      userPermissions.includes(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException('اجازه دسترسی به این بخش را ندارید');
    }

    return true;
  }
}
