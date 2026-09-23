import { Module } from '@nestjs/common';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';

// Exports PurchaseRequestsService so PurchasesModule can inject it and
// trigger the request's automatic status recompute after a linked Purchase
// changes — see purchases.module.ts / purchases.service.ts.
@Module({
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
