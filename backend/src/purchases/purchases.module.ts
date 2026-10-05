import { Module } from '@nestjs/common';
import { PurchaseFilesController } from './purchase-files.controller';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PurchaseRequestsModule } from '../purchase-requests/purchase-requests.module';

// Imports PurchaseRequestsModule so PurchasesService can call
// PurchaseRequestsService.recomputeStatus() after a linked Purchase is
// created, edited, or removed — the request's own module still owns that
// status logic; Purchases only triggers it (see purchases.service.ts).
@Module({
  imports: [PurchaseRequestsModule],
  controllers: [PurchasesController, PurchaseFilesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
