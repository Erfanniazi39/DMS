import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import type { CreateUserDto } from './dto/create-user.dto';
import { createUserSchema } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { updateUserSchema } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users.create')
  @UsePipes(new ZodValidationPipe(createUserSchema))
  create(@Body() dto: CreateUserDto, @Req() req: Request) {
    return this.usersService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Get()
  @RequirePermissions('users.create')
  list() {
    return this.usersService.list();
  }

  @Get(':id')
  @RequirePermissions('users.create')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.get(id);
  }

  @Patch(':id')
  @RequirePermissions('users.create')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.usersService.update(id, dto, req.session.userId ?? null, req.ip);
  }
}
