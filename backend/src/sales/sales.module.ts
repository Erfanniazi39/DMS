import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { SalesReturnsController } from './sales-returns.controller';
import { SalesReturnsService } from './sales-returns.service';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';

// Dependency direction (build plan §3): receivables → sales → inventory.
// Imports InventoryModule for InventoryService (default warehouse,
// availability display); stock WRITES go through inventory/stock-ledger.ts
// plain functions inside Sales' own transactions. Never imports
// CustomersModule — customers are checked via customers/customer-rules.ts.
// PrismaModule and AuditModule are global. SalesReturnsService is exported
// so Receivables' CreditNotesService can call markCredited() (batch 6).
@Module({
  imports: [InventoryModule],
  controllers: [SalesOrdersController, DeliveriesController, SalesInvoicesController, SalesReturnsController, SalesReportsController],
  providers: [SalesOrdersService, DeliveriesService, SalesInvoicesService, SalesReturnsService, SalesReportsService],
  exports: [SalesOrdersService, DeliveriesService, SalesInvoicesService, SalesReturnsService],
})
export class SalesModule {}
