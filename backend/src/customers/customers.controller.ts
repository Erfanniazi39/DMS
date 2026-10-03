import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { CustomersService } from './customers.service';
import { createCustomerSchema, updateCustomerSchema, type CreateCustomerDto, type UpdateCustomerDto } from './dto/customer.dto';

@Controller('customers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  list(
    @Query('q') q?: string,
    @Query('customerType') customerType?: string,
    // Opt-in pagination — see parsePagination(). Omitted = full array.
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.customersService.list(
      { q: q?.trim() || undefined, customerType: customerType || undefined },
      parsePagination(page, pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.get(id);
  }

  // Zod pipe bound to @Body() only (not method-level) — see SuppliersController.
  @Post()
  @RequirePermissions('customers.manage')
  create(@Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerDto, @Req() req: Request) {
    return this.customersService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    return this.customersService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id')
  @RequirePermissions('customers.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.customersService.remove(id, req.session.userId ?? null, req.ip);
  }
}
