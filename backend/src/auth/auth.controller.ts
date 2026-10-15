import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { featureFlags } from '../common/feature-flags';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginThrottle, retryMinutes } from './login-throttle';
import { enforceSessionAccess } from './session-access';
import type { LoginDto } from './dto/login.dto';
import { loginSchema } from './dto/login.dto';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottle,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const ip = req.ip ?? 'unknown';
    // Too many recent failures: refuse before looking at the password (security review H2).
    const gate = this.throttle.check(ip, body.username);
    if (gate.blocked) {
      throw new HttpException(
        { statusCode: 429, message: `تعداد تلاش‌های ناموفق ورود زیاد بوده است. ${retryMinutes(gate.retryAfterMs).toLocaleString('fa-IR')} دقیقه دیگر دوباره تلاش کنید.` },
        429,
      );
    }
    const result = await this.authService.attemptLogin(body.username, body.password);

    if (result.status !== 'ok') {
      if (this.throttle.recordFailure(ip, body.username)) {
        await this.audit.log({ userId: null, action: 'LOGIN_THROTTLED', details: body.username.slice(0, 50), ipAddress: req.ip });
      }
      await this.audit.log({
        userId: null,
        action: `LOGIN_FAILED:${body.username}:${result.status}`,
        ipAddress: req.ip,
      });
      // "not_found" and "invalid_password" intentionally share the same generic
      // message, so a login attempt can't be used to guess which usernames exist.
      // "locked"/"disabled" tell the user the real reason, per their own request —
      // that does confirm the account exists, but only for accounts an admin has
      // already deliberately locked or disabled.
      const messageByStatus: Record<Exclude<typeof result.status, 'ok'>, string> = {
        not_found: 'نام کاربری یا رمز عبور اشتباه است',
        invalid_password: 'نام کاربری یا رمز عبور اشتباه است',
        locked: 'این حساب کاربری قفل شده است. برای رفع مشکل با مدیر سیستم تماس بگیرید.',
        disabled: 'این حساب کاربری غیرفعال شده است. برای رفع مشکل با مدیر سیستم تماس بگیرید.',
      };
      throw new UnauthorizedException(messageByStatus[result.status]);
    }

    this.throttle.recordSuccess(ip, body.username);
    const user = result.user;
    const permissions = this.authService.getPermissionNames(user);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.roleId = user.roleId;
    req.session.permissions = permissions;

    await this.authService.recordLogin(user.id);
    await this.audit.log({ userId: user.id, action: 'LOGIN', ipAddress: req.ip });

    return {
      id: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
    };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.session.userId ?? null;
    return new Promise((resolve) => {
      void this.audit.log({ userId, action: 'LOGOUT', ipAddress: req.ip }).finally(() => {
        req.session.destroy(() => {
          res.clearCookie('connect.sid');
          resolve({ success: true });
        });
      });
    });
  }

  @Get('me')
  async me(@Req() req: Request) {
    if (!req.session.userId) {
      throw new UnauthorizedException();
    }
    // Same freshness check as every guarded route: a disabled account is signed out here too.
    await enforceSessionAccess(this.prisma, req);
    return {
      id: req.session.userId,
      username: req.session.username,
      permissions: req.session.permissions ?? [],
      features: featureFlags(),
    };
  }
}
