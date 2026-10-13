import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Read-only analytics over existing modules' tables. Deliberately does not
// import PurchasesModule/PurchaseRequestsModule/SalesModule — it only reads
// via Prisma and never goes through their write/recompute logic. Every
// business rule it filters on ("open", "outstanding", CANCELLED exclusion,
// what counts as a sale) is imported from the owning module's rule file
// (purchase-rules.ts, purchase-request-rules.ts, sales/sales-rules.ts),
// never redefined here (CLAUDE.md rule 11). Audit-log reads (recent
// activity) go through the global AuditService.
//
// I3 is the one exception to "no module imports": the low-stock KPI is a
// real business rule (what counts as "low" — B14), not just a raw-table
// aggregate, so it is deliberately NOT re-derived here — InventoryModule is
// imported so DashboardService can call InventoryReportsService.lowStockSummary()
// directly, the same discipline CLAUDE.md rule 11 asks for.
@Module({
  imports: [InventoryModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
