import { Module } from '@nestjs/common';
import { PurchaseQuantitiesService } from './purchase-quantities.service';

// Imports nothing (PrismaModule is global), so both PurchaseRequestsModule
// and PurchasesModule can depend on it without forming a module cycle —
// see purchase-quantities.service.ts.
@Module({
  providers: [PurchaseQuantitiesService],
  exports: [PurchaseQuantitiesService],
})
export class PurchaseQuantitiesModule {}
