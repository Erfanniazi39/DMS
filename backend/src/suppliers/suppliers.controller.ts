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

// suppliers.viewSensitive: national/economic identifiers and bank numbers.
function sensitive(req?: Request) {
  return { canViewSensitive: (req?.session?.permissions ?? []).includes('suppliers.viewSensitive') };
}

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
    @Req() req?: Request,
  ) {
    return this.suppliersService.list({ q: q?.trim() || undefined, status: status || undefined, sort: parseSort(sortBy, sortDir) }, parsePagination(page, pageSize), sensitive(req));
  }

  // Suggested code for a new record — declared before any ':id' route.
  @Get('next-code')
  @RequirePermissions('suppliers.manage')
  nextCode() {
    return this.suppliersService.nextCode();
  }

  @Get(':id')
  @RequirePermissions('suppliers.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.suppliersService.get(id, sensitive(req));
  }

  @Post()
  @RequirePermissions('suppliers.manage')
  // The Zod pipe is bound to the @Body() parameter specifically, not to the
  // method with @UsePipes() — a method-level pipe runs against EVERY
  // parameter, including the :id route param on update(). See the identical
  // fix already applied to DepartmentsController and EmployeesController.
  create(@Body(new ZodValidationPipe(createSupplierSchema)) dto: CreateSupplierDto, @Req() req: Request) {
    return this.suppliersService.create(dto, req.session.userId ?? null, req.ip, sensitive(req));
  }

  // Editing the header (identity fields) needs suppliers.viewSensitive too, so a
  // masked value can never be submitted back over the real one.
  @Patch(':id')
  @RequirePermissions('suppliers.manage', 'suppliers.viewSensitive')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateSupplierSchema)) dto: UpdateSupplierDto, @Req() req: Request) {
    return this.suppliersService.update(id, dto, req.session.userId ?? null, req.ip, sensitive(req));
  }

  @Delete(':id')
  @RequirePermissions('suppliers.delete')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.suppliersService.remove(id, req.session.userId ?? null, req.ip);
  }

  // --- Bank accounts (served inside GET /suppliers/:id) -----------------------

  @Post(':id/bank-accounts')
  @RequirePermissions('suppliers.manage')
  addBankAccount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(supplierBankAccountSchema)) dto: SupplierBankAccountDto, @Req() req: Request) {
    return this.bankAccountsService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  // Editing an account needs suppliers.viewSensitive: callers without it only see masked numbers.
  @Patch(':id/bank-accounts/:accountId')
  @RequirePermissions('suppliers.manage', 'suppliers.viewSensitive')
  updateBankAccount(
    @Param('id', ParseIntPipe) id: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body(new ZodValidationPipe(supplierBankAccountSchema)) dto: SupplierBankAccountDto,
    @Req() req: Request,
  ) {
    return this.bankAccountsService.update(id, accountId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/bank-accounts/:accountId')
  @RequirePermissions('suppliers.delete')
  removeBankAccount(@Param('id', ParseIntPipe) id: number, @Param('accountId', ParseIntPipe) accountId: number, @Req() req: Request) {
    return this.bankAccountsService.remove(id, accountId, req.session.userId ?? null, req.ip);
  }
}
