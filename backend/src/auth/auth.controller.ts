import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import { loginSchema } from './dto/login.dto';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const result = await this.authService.attemptLogin(body.username, body.password);

    if (result.status !== 'ok') {
      await this.authService.writeAuditLog(
        null,
        `LOGIN_FAILED:${body.username}:${result.status}`,
        req.ip,
      );
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

    const user = result.user;
    const permissions = this.authService.getPermissionNames(user);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.roleId = user.roleId;
    req.session.permissions = permissions;

    await this.authService.recordLogin(user.id);
    await this.authService.writeAuditLog(user.id, 'LOGIN', req.ip);

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
      void this.authService.writeAuditLog(userId, 'LOGOUT', req.ip).finally(() => {
        req.session.destroy(() => {
          res.clearCookie('connect.sid');
          resolve({ success: true });
        });
      });
    });
  }

  @Get('me')
  me(@Req() req: Request) {
    if (!req.session.userId) {
      throw new UnauthorizedException();
    }
    return {
      id: req.session.userId,
      username: req.session.username,
      permissions: req.session.permissions ?? [],
    };
  }
}
