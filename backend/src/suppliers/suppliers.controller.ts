import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { SuppliersService } from './suppliers.service';
import { createSupplierSchema, updateSupplierSchema, type CreateSupplierDto, type UpdateSupplierDto } from './dto/supplier.dto';

@Controller('suppliers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.view')
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    // Opt-in pagination — see parsePagination(). Omitted = full array.
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.suppliersService.list({ q: q?.trim() || undefined, status: status || undefined }, parsePagination(page, pageSize));
  }

  @Get(':id')
  @RequirePermissions('suppliers.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.suppliersService.get(id);
  }

  @Post()
  @RequirePermissions('suppliers.manage')
  // The Zod pipe is bound to the @Body() parameter specifically, not to the
  // method with @UsePipes() — a method-level pipe runs against EVERY
  // parameter, including the :id route param on update(). See the identical
  // fix already applied to DepartmentsController and EmployeesController.
  create(@Body(new ZodValidationPipe(createSupplierSchema)) dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateSupplierSchema)) dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('suppliers.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.suppliersService.remove(id);
  }
}
