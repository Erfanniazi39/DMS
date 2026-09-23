import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { DepartmentsService } from './departments.service';
import { createDepartmentSchema, updateDepartmentSchema, type CreateDepartmentDto, type UpdateDepartmentDto } from './dto/department.dto';

@Controller('departments')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  list() {
    return this.departmentsService.list();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.get(id);
  }

  @Post()
  @RequirePermissions('employees.manage')
  // The Zod pipe is bound to the @Body() parameter specifically, not to the
  // method with @UsePipes() — a method-level pipe runs against EVERY
  // parameter, including the :id route param on update(), which produces
  // "Invalid input: expected object, received string" on every edit.
  create(@Body(new ZodValidationPipe(createDepartmentSchema)) dto: CreateDepartmentDto) {
    return this.departmentsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('employees.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateDepartmentSchema)) dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employees.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.remove(id);
  }
}
