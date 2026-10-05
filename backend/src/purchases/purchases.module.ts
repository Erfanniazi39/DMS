import { Module } from '@nestjs/common';
import { PurchaseFilesController } from './purchase-files.controller';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PurchasePaymentsService } from './purchase-payments.service';
import { PurchaseDocumentsService } from './purchase-documents.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseQuantitiesModule } from './purchase-quantities.module';
import { PurchaseRequestsModule } from '../purchase-requests/purchase-requests.module';

// Imports PurchaseRequestsModule so PurchasesService can call
// PurchaseRequestsService.recomputeStatus() after a linked Purchase is
// created, edited, or removed — the request's own module still owns that
// status logic; Purchases only triggers it (see purchases.service.ts).
//
// Imports PurchaseQuantitiesModule for PurchasesService's overage check. That
// module imports nothing, and PurchaseRequestsModule imports it too (never
// PurchasesModule), so the module graph stays acyclic.
//
// Provider graph inside this module (no cycles): PurchasePaymentsService and
// PurchaseDocumentsService depend on PurchasesService (for get()); it never
// depends on them. PurchaseReturnsService depends on neither.
@Module({
  imports: [PurchaseRequestsModule, PurchaseQuantitiesModule],
  controllers: [PurchasesController, PurchaseFilesController],
  providers: [PurchasesService, PurchasePaymentsService, PurchaseDocumentsService, PurchaseReturnsService],
})
export class PurchasesModule {}
