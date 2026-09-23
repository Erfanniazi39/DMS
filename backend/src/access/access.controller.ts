import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AccessService } from './access.service';

const roleSchema = z.object({ name: z.string().trim().min(2).max(80), permissionCodes: z.array(z.string()).default([]) });
const permissionSchema = z.object({ permissionCodes: z.array(z.string()) });

@Controller('access')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('users.create')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get('roles')
  listRoles() { return this.accessService.listRoles(); }

  @Post('roles')
  createRole(@Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.accessService.createRole(body.name, body.permissionCodes);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(permissionSchema)) body: z.infer<typeof permissionSchema>) {
    return this.accessService.updateRole(id, body.permissionCodes);
  }

  @Get('permissions')
  listPermissions() { return this.accessService.listPermissions(); }

  @Get('user-permissions')
  listUserPermissions() { return this.accessService.listUserPermissions(); }

  @Patch('user-permissions/:id')
  setUserPermissions(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(permissionSchema)) body: z.infer<typeof permissionSchema>) {
    return this.accessService.setUserPermissions(id, body.permissionCodes);
  }
}
