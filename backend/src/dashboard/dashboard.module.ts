import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Read-only analytics over existing modules' tables. Deliberately does not
// import PurchasesModule/PurchaseRequestsModule — it only reads via Prisma
// and never goes through (or duplicates) their write/recompute logic.
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
