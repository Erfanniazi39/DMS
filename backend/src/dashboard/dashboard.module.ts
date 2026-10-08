import { Module } from '@nestjs/common';
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
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
