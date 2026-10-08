import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { SalesOrdersService, type SalesActor } from './sales-orders.service';
import {
  approveSalesOrderSchema,
  cancelSalesOrderSchema,
  closeSalesOrderSchema,
  confirmSalesOrderSchema,
  createSalesOrderSchema,
  rejectSalesOrderSchema,
  salesOrderListQuerySchema,
  updateSalesOrderSchema,
  type ApproveSalesOrderDto,
  type CancelSalesOrderDto,
  type CloseSalesOrderDto,
  type ConfirmSalesOrderDto,
  type CreateSalesOrderDto,
  type RejectSalesOrderDto,
  type SalesOrderListQuery,
  type UpdateSalesOrderDto,
} from './dto/sales-order.dto';

function actorOf(req: Request): SalesActor {
  const permissions = req.session?.permissions ?? [];
  const canApprove = permissions.includes('sales.approve');
  return {
    userId: req.session.userId ?? null,
    ipAddress: req.ip,
    canApprove,
    canViewCredit: canApprove || permissions.includes('customers.finance'),
  };
}

// Reading needs sales.view. Creating / editing / deleting a draft,
// confirming (incl. submitting for approval), cancelling and closing need
// sales.manage. Approving / rejecting a PENDING_APPROVAL order needs
// sales.approve. Discounts (B3) and credit overrides (B4) are further gated
// on sales.approve inside SalesOrdersService (actorOf().canApprove).
@Controller('sales-orders')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesOrdersController {
  constructor(private readonly salesOrders: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales.view')
  list(@Query(new ZodValidationPipe(salesOrderListQuerySchema)) query: SalesOrderListQuery) {
    return this.salesOrders.list(
      {
        q: query.q?.trim() || undefined,
        status: query.status,
        deliveryStatus: query.deliveryStatus,
        invoicingStatus: query.invoicingStatus,
        paymentStatus: query.paymentStatus,
        customerId: query.customerId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so they aren't captured by ParseIntPipe.
  @Get('form-options')
  @RequirePermissions('sales.manage')
  formOptions() {
    return this.salesOrders.formOptions();
  }

  @Get('customer-context/:customerId')
  @RequirePermissions('sales.manage')
  customerContext(@Param('customerId', ParseIntPipe) customerId: number, @Req() req: Request) {
    return this.salesOrders.customerContext(customerId, actorOf(req));
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.salesOrders.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('sales.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.salesOrders.history(id);
  }

  @Post()
  @RequirePermissions('sales.manage')
  create(@Body(new ZodValidationPipe(createSalesOrderSchema)) dto: CreateSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.create(dto, actorOf(req));
  }

  @Patch(':id')
  @RequirePermissions('sales.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateSalesOrderSchema)) dto: UpdateSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.update(id, dto, actorOf(req));
  }

  // DRAFT only.
  @Delete(':id')
  @RequirePermissions('sales.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.salesOrders.remove(id, actorOf(req));
  }

  // DRAFT → CONFIRMED (number + reservation) or → PENDING_APPROVAL.
  @Post(':id/confirm')
  @RequirePermissions('sales.manage')
  confirm(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(confirmSalesOrderSchema)) dto: ConfirmSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.confirm(id, dto, actorOf(req));
  }

  @Post(':id/approve')
  @RequirePermissions('sales.approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(approveSalesOrderSchema)) dto: ApproveSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.approve(id, dto, actorOf(req));
  }

  @Post(':id/reject')
  @RequirePermissions('sales.approve')
  reject(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(rejectSalesOrderSchema)) dto: RejectSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.reject(id, dto, actorOf(req));
  }

  @Post(':id/cancel')
  @RequirePermissions('sales.manage')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(cancelSalesOrderSchema)) dto: CancelSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.cancel(id, dto, actorOf(req));
  }

  @Post(':id/close')
  @RequirePermissions('sales.manage')
  close(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(closeSalesOrderSchema)) dto: CloseSalesOrderDto, @Req() req: Request) {
    return this.salesOrders.close(id, dto, actorOf(req));
  }
}
