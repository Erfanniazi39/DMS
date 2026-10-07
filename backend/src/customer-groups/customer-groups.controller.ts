import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createCustomerGroupSchema,
  updateCustomerGroupSchema,
  type CreateCustomerGroupDto,
  type UpdateCustomerGroupDto,
} from './dto/customer-group.dto';
import { CustomerGroupsService } from './customer-groups.service';

// Mirrors ItemCategoriesController. Gated on the customers.* pair (Customer
// Group is customer master data).
@Controller('customer-groups')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomerGroupsController {
  constructor(private readonly customerGroupsService: CustomerGroupsService) {}

  // Active-only, no permission beyond being logged in — backs the group
  // dropdown on the Customer form and list filter. Do not gate.
  @Get()
  list() {
    return this.customerGroupsService.list();
  }

  // Every group including inactive ones, for the /customer-groups page.
  @Get('all')
  @RequirePermissions('customers.view')
  listAll() {
    return this.customerGroupsService.listAll();
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@Body(new ZodValidationPipe(createCustomerGroupSchema)) dto: CreateCustomerGroupDto, @Req() req: Request) {
    return this.customerGroupsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateCustomerGroupSchema)) dto: UpdateCustomerGroupDto,
    @Req() req: Request,
  ) {
    return this.customerGroupsService.update(id, dto, req.session.userId ?? null, req.ip);
  }
}
