import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
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
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('users.create')
  list() {
    return this.usersService.list();
  }

  @Patch(':id')
  @RequirePermissions('users.create')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }
}
