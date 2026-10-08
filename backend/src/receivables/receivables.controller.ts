import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CustomerBalancesService } from './customer-balances.service';
import { CustomerPaymentsService, type ReceivablesActor } from './customer-payments.service';
import { PaymentAllocationsService } from './payment-allocations.service';
import {
  allocatePaymentSchema,
  reverseAllocationSchema,
  suggestAllocationQuerySchema,
  type AllocatePaymentDto,
  type ReverseAllocationDto,
  type SuggestAllocationQuery,
} from './dto/payment-allocation.dto';
import {
  bounceChequeSchema,
  cancelCustomerPaymentSchema,
  clearChequeSchema,
  createCustomerReceiptSchema,
  createCustomerRefundSchema,
  customerPaymentListQuerySchema,
  type BounceChequeDto,
  type CancelCustomerPaymentDto,
  type ClearChequeDto,
  type CreateCustomerReceiptDto,
  type CreateCustomerRefundDto,
  type CustomerPaymentListQuery,
} from './dto/customer-payment.dto';

function actorOf(req: Request): ReceivablesActor {
  return { userId: req.session.userId ?? null, ipAddress: req.ip };
}

// Reading (balance/statement/aging/payment list+history) needs
// receivables.view. Recording/allocating/cancelling/clearing/bouncing
// payments needs receivables.manage — per build plan B5, SALES_MANAGER
// gets only receivables.view (separation of duties: a manager can see money
// owed but not record or allocate it).
@Controller('receivables')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReceivablesController {
  constructor(
    private readonly payments: CustomerPaymentsService,
    private readonly allocations: PaymentAllocationsService,
    private readonly balances: CustomerBalancesService,
  ) {}

  // --- Payments (دریافت‌ها) ---------------------------------------------------

  @Get('payments')
  @RequirePermissions('receivables.view')
  list(@Query(new ZodValidationPipe(customerPaymentListQuerySchema)) query: CustomerPaymentListQuery) {
    return this.payments.list(
      {
        q: query.q?.trim() || undefined,
        direction: query.direction,
        status: query.status,
        method: query.method,
        customerId: query.customerId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so it isn't captured by ParseIntPipe.
  @Get('payments/form-options')
  @RequirePermissions('receivables.manage')
  formOptions() {
    return this.payments.formOptions();
  }

  @Get('payments/:id')
  @RequirePermissions('receivables.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.payments.get(id);
  }

  @Get('payments/:id/history')
  @RequirePermissions('receivables.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.payments.history(id);
  }

  @Post('payments')
  @RequirePermissions('receivables.manage')
  recordReceipt(@Body(new ZodValidationPipe(createCustomerReceiptSchema)) dto: CreateCustomerReceiptDto, @Req() req: Request) {
    return this.payments.recordReceipt(dto, actorOf(req));
  }

  @Post('refunds')
  @RequirePermissions('receivables.manage')
  recordRefund(@Body(new ZodValidationPipe(createCustomerRefundSchema)) dto: CreateCustomerRefundDto, @Req() req: Request) {
    return this.payments.refund(dto, actorOf(req));
  }

  @Post('payments/:id/cancel')
  @RequirePermissions('receivables.manage')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(cancelCustomerPaymentSchema)) dto: CancelCustomerPaymentDto, @Req() req: Request) {
    return this.payments.cancel(id, dto, actorOf(req));
  }

  @Post('payments/:id/clear-cheque')
  @RequirePermissions('receivables.manage')
  clearCheque(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(clearChequeSchema)) dto: ClearChequeDto, @Req() req: Request) {
    return this.payments.clearCheque(id, dto, actorOf(req));
  }

  @Post('payments/:id/bounce-cheque')
  @RequirePermissions('receivables.manage')
  bounceCheque(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(bounceChequeSchema)) dto: BounceChequeDto, @Req() req: Request) {
    return this.payments.bounceCheque(id, dto, actorOf(req));
  }

  // --- Allocations (تخصیص‌ها) -------------------------------------------------

  @Get('allocations/suggest')
  @RequirePermissions('receivables.manage')
  suggestAllocation(@Query(new ZodValidationPipe(suggestAllocationQuerySchema)) query: SuggestAllocationQuery) {
    return this.allocations.suggestAllocation(query.customerId, query.amount);
  }

  @Post('allocations')
  @RequirePermissions('receivables.manage')
  allocate(@Body(new ZodValidationPipe(allocatePaymentSchema)) dto: AllocatePaymentDto, @Req() req: Request) {
    return this.allocations.allocate(dto, actorOf(req));
  }

  @Post('allocations/:id/reverse')
  @RequirePermissions('receivables.manage')
  reverseAllocation(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reverseAllocationSchema)) dto: ReverseAllocationDto, @Req() req: Request) {
    return this.allocations.reverse(id, dto, actorOf(req));
  }

  // --- Customer balance / statement / aging ----------------------------------

  @Get('customers/:customerId/balance')
  @RequirePermissions('receivables.view')
  async balance(@Param('customerId', ParseIntPipe) customerId: number) {
    return { customerId, balance: await this.balances.getBalance(customerId) };
  }

  @Get('customers/:customerId/open-invoices')
  @RequirePermissions('receivables.view')
  openInvoices(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.balances.getOpenInvoices(customerId);
  }

  @Get('customers/:customerId/statement')
  @RequirePermissions('receivables.view')
  statement(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.balances.getStatement(customerId);
  }

  @Get('customers/:customerId/aging')
  @RequirePermissions('receivables.view')
  customerAging(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.balances.getCustomerAging(customerId);
  }

  @Get('aging')
  @RequirePermissions('receivables.view')
  agingReport() {
    return this.balances.getAgingReport();
  }
}
