import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { SalesInvoicesService, type SalesInvoiceActor } from './sales-invoices.service';
import {
  createOpeningBalanceInvoiceSchema,
  createSalesInvoiceSchema,
  postSalesInvoiceSchema,
  salesInvoiceListQuerySchema,
  salesInvoiceQueueQuerySchema,
  type CreateOpeningBalanceInvoiceDto,
  type CreateSalesInvoiceDto,
  type PostSalesInvoiceDto,
  type SalesInvoiceListQuery,
  type SalesInvoiceQueueQuery,
} from './dto/sales-invoice.dto';

function actorOf(req: Request): SalesInvoiceActor {
  return { userId: req.session.userId ?? null, ipAddress: req.ip };
}

// Reading needs sales.view. Everything that writes — creating a draft (from
// a delivery or as an opening balance), deleting a draft and posting — needs
// sales.invoice (B5: ACCOUNTANT and SALES_MANAGER hold it; SALESPERSON and
// WAREHOUSE don't). The opening-balance form lookup is sales.invoice too.
// There is deliberately no endpoint for the settlement fields: they change
// only through SalesInvoicesService.applySettlement(), called by Receivables.
@Controller('sales-invoices')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesInvoicesController {
  constructor(private readonly invoices: SalesInvoicesService) {}

  @Get()
  @RequirePermissions('sales.view')
  list(@Query(new ZodValidationPipe(salesInvoiceListQuerySchema)) query: SalesInvoiceListQuery) {
    return this.invoices.list(
      {
        q: query.q?.trim() || undefined,
        status: query.status,
        sourceType: query.sourceType,
        paymentStatus: query.paymentStatus,
        overdue: query.overdue === 'true' ? true : undefined,
        customerId: query.customerId,
        salesOrderId: query.salesOrderId,
        deliveryId: query.deliveryId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so they aren't captured by ParseIntPipe.
  @Get('queue')
  @RequirePermissions('sales.view')
  queue(@Query(new ZodValidationPipe(salesInvoiceQueueQuerySchema)) query: SalesInvoiceQueueQuery) {
    return this.invoices.queue(query.q?.trim() || undefined, parsePagination(query.page, query.pageSize));
  }

  @Get('form-options')
  @RequirePermissions('sales.invoice')
  formOptions() {
    return this.invoices.formOptions();
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('sales.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.history(id);
  }

  // DRAFT from a POSTED delivery.
  @Post()
  @RequirePermissions('sales.invoice')
  create(@Body(new ZodValidationPipe(createSalesInvoiceSchema)) dto: CreateSalesInvoiceDto, @Req() req: Request) {
    return this.invoices.create(dto, actorOf(req));
  }

  // DRAFT opening-balance invoice (historical receivables).
  @Post('opening-balance')
  @RequirePermissions('sales.invoice')
  createOpeningBalance(@Body(new ZodValidationPipe(createOpeningBalanceInvoiceSchema)) dto: CreateOpeningBalanceInvoiceDto, @Req() req: Request) {
    return this.invoices.createOpeningBalance(dto, actorOf(req));
  }

  // DRAFT only.
  @Delete(':id')
  @RequirePermissions('sales.invoice')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.invoices.remove(id, actorOf(req));
  }

  // DRAFT → POSTED (number + due date + order progress).
  @Post(':id/post')
  @RequirePermissions('sales.invoice')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postSalesInvoiceSchema)) dto: PostSalesInvoiceDto, @Req() req: Request) {
    return this.invoices.post(id, dto, actorOf(req));
  }
}
