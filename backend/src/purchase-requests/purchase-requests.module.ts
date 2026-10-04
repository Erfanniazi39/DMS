import { Module } from '@nestjs/common';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseQuantitiesModule } from '../purchases/purchase-quantities.module';

// Exports PurchaseRequestsService so PurchasesModule can inject it and
// trigger the request's automatic status recompute after a linked Purchase
// changes — see purchases.module.ts / purchases.service.ts.
//
// Imports PurchaseQuantitiesModule (not PurchasesModule — that would be a
// cycle) to ask the Purchases module how much of each request item has been
// purchased, instead of re-deriving that rule here (CLAUDE.md rule 11).
@Module({
  imports: [PurchaseQuantitiesModule],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
