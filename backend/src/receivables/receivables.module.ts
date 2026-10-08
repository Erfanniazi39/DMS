import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { CustomerBalancesService } from './customer-balances.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { PaymentAllocationsService } from './payment-allocations.service';
import { QuickSaleController } from './quick-sale.controller';
import { QuickSaleService } from './quick-sale.service';
import { ReceivablesController } from './receivables.controller';

// Dependency direction (build plan §3): receivables → sales → inventory.
// Imports SalesModule for SalesInvoicesService (applySettlement(),
// listOpenForCustomer()) and, since batch 6, SalesReturnsService
// (markCredited()) — both the approved cross-module calls (see
// settlement.ts / credit-notes.service.ts). SalesModule does NOT import
// ReceivablesModule, so there is no cycle. Never imports CustomersModule —
// a customer's existence/kind is checked with a plain Prisma lookup
// (CLAUDE.md rule 11's documented read-only exception), same as Sales does
// via customers/customer-rules.ts. PrismaModule and AuditModule are global.
@Module({
  imports: [SalesModule],
  controllers: [ReceivablesController, CreditNotesController, QuickSaleController],
  providers: [CustomerPaymentsService, PaymentAllocationsService, CustomerBalancesService, CreditNotesService, QuickSaleService],
  exports: [CustomerPaymentsService, PaymentAllocationsService, CustomerBalancesService, CreditNotesService, QuickSaleService],
})
export class ReceivablesModule {}
