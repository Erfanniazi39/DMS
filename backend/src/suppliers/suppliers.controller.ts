import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination, parseSort } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { SuppliersService } from './suppliers.service';
import { SupplierBankAccountsService } from './supplier-bank-accounts.service';
import {
  createSupplierSchema,
  supplierBankAccountSchema,
  updateSupplierSchema,
  type CreateSupplierDto,
  type SupplierBankAccountDto,
  type UpdateSupplierDto,
} from './dto/supplier.dto';

@Controller('suppliers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly bankAccountsService: SupplierBankAccountsService,
  ) {}

  @Get()
  @RequirePermissions('suppliers.view')
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    // Opt-in pagination — see parsePagination(). Omitted = full array.
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.suppliersService.list({ q: q?.trim() || undefined, status: status || undefined, sort: parseSort(sortBy, sortDir) }, parsePagination(page, pageSize));
  }

  // Suggested code for a new record — declared before any ':id' route.
  @Get('next-code')
  @RequirePermissions('suppliers.manage')
  nextCode() {
    return this.suppliersService.nextCode();
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
  create(@Body(new ZodValidationPipe(createSupplierSchema)) dto: CreateSupplierDto, @Req() req: Request) {
    return this.suppliersService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateSupplierSchema)) dto: UpdateSupplierDto, @Req() req: Request) {
    return this.suppliersService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id')
  @RequirePermissions('suppliers.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.suppliersService.remove(id);
  }

  // --- Bank accounts (served inside GET /suppliers/:id) -----------------------

  @Post(':id/bank-accounts')
  @RequirePermissions('suppliers.manage')
  addBankAccount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(supplierBankAccountSchema)) dto: SupplierBankAccountDto, @Req() req: Request) {
    return this.bankAccountsService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/bank-accounts/:accountId')
  @RequirePermissions('suppliers.manage')
  updateBankAccount(
    @Param('id', ParseIntPipe) id: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body(new ZodValidationPipe(supplierBankAccountSchema)) dto: SupplierBankAccountDto,
    @Req() req: Request,
  ) {
    return this.bankAccountsService.update(id, accountId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/bank-accounts/:accountId')
  @RequirePermissions('suppliers.manage')
  removeBankAccount(@Param('id', ParseIntPipe) id: number, @Param('accountId', ParseIntPipe) accountId: number, @Req() req: Request) {
    return this.bankAccountsService.remove(id, accountId, req.session.userId ?? null, req.ip);
  }
}
