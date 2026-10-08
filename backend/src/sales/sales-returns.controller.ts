import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { SalesReturnsService, type SalesReturnActor } from './sales-returns.service';
import {
  approveSalesReturnSchema,
  cancelSalesReturnSchema,
  completeReturnWithoutCreditSchema,
  inspectSalesReturnSchema,
  receiveSalesReturnSchema,
  rejectSalesReturnSchema,
  requestSalesReturnSchema,
  salesReturnListQuerySchema,
  type ApproveSalesReturnDto,
  type CancelSalesReturnDto,
  type CompleteReturnWithoutCreditDto,
  type InspectSalesReturnDto,
  type ReceiveSalesReturnDto,
  type RejectSalesReturnDto,
  type RequestSalesReturnDto,
  type SalesReturnListQuery,
} from './dto/sales-return.dto';

function actorOf(req: Request): SalesReturnActor {
  return { userId: req.session.userId ?? null, ipAddress: req.ip };
}

// Reading needs sales.view. Requesting a return needs sales.manage (the
// salesperson/customer-service side). Approve/reject/inspect/the no-credit
// close need sales.approve (manager judgment, same gate as a discount —
// build plan's "disposition is a judgment call matching who can discount").
// Receive is a warehouse action: gated on sales.deliver, the same permission
// that governs issuing goods on a Delivery (receiving them back is the
// mirror of that — business decision for this batch, documented here).
@Controller('sales-returns')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @Get()
  @RequirePermissions('sales.view')
  list(@Query(new ZodValidationPipe(salesReturnListQuerySchema)) query: SalesReturnListQuery) {
    return this.returns.list(
      {
        q: query.q?.trim() || undefined,
        status: query.status,
        customerId: query.customerId,
        salesOrderId: query.salesOrderId,
        deliveryId: query.deliveryId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so it isn't captured by ParseIntPipe.
  @Get('delivery-context/:deliveryId')
  @RequirePermissions('sales.manage')
  deliveryContext(@Param('deliveryId', ParseIntPipe) deliveryId: number) {
    return this.returns.deliveryContext(deliveryId);
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.returns.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('sales.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.returns.history(id);
  }

  @Post()
  @RequirePermissions('sales.manage')
  request(@Body(new ZodValidationPipe(requestSalesReturnSchema)) dto: RequestSalesReturnDto, @Req() req: Request) {
    return this.returns.request(dto, actorOf(req));
  }

  @Post(':id/approve')
  @RequirePermissions('sales.approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(approveSalesReturnSchema)) dto: ApproveSalesReturnDto, @Req() req: Request) {
    return this.returns.approve(id, dto, actorOf(req));
  }

  @Post(':id/reject')
  @RequirePermissions('sales.approve')
  reject(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(rejectSalesReturnSchema)) dto: RejectSalesReturnDto, @Req() req: Request) {
    return this.returns.reject(id, dto, actorOf(req));
  }

  @Post(':id/cancel')
  @RequirePermissions('sales.manage')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(cancelSalesReturnSchema)) dto: CancelSalesReturnDto, @Req() req: Request) {
    return this.returns.cancel(id, dto, actorOf(req));
  }

  @Post(':id/receive')
  @RequirePermissions('sales.deliver')
  receive(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(receiveSalesReturnSchema)) dto: ReceiveSalesReturnDto, @Req() req: Request) {
    return this.returns.receive(id, dto, actorOf(req));
  }

  @Post(':id/inspect')
  @RequirePermissions('sales.approve')
  inspect(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(inspectSalesReturnSchema)) dto: InspectSalesReturnDto, @Req() req: Request) {
    return this.returns.inspect(id, dto, actorOf(req));
  }

  @Post(':id/complete-without-credit')
  @RequirePermissions('sales.approve')
  completeWithoutCredit(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(completeReturnWithoutCreditSchema)) dto: CompleteReturnWithoutCreditDto,
    @Req() req: Request,
  ) {
    return this.returns.completeWithoutCredit(id, dto, actorOf(req));
  }
}
