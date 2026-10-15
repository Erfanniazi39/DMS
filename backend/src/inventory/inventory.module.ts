import { Module } from '@nestjs/common';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { GoodsReturnsController } from './goods-returns.controller';
import { GoodsReturnsService } from './goods-returns.service';
import { InventoryAdminController } from './inventory-admin.controller';
import { InventoryController } from './inventory.controller';
import { InventoryItemSettingsService } from './inventory-item-settings.service';
import { InventoryReportsController } from './inventory-reports.controller';
import { InventoryReportsService } from './inventory-reports.service';
import { InventoryService } from './inventory.service';
import { ProductionOutputsController } from './production-outputs.controller';
import { ProductionOutputsService } from './production-outputs.service';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsService } from './stock-counts.service';
import { StockLevelsService } from './stock-levels.service';
import { GoodsReceiptsRestorer, ProductionOutputsRestorer, StockAdjustmentsRestorer, StockCountsRestorer, GoodsReturnsRestorer } from './inventory.restorers';

// Imports nothing (PrismaModule and AuditModule are global). Exports
// InventoryService so the later Sales/Returns modules can read availability;
// stock writes from those modules go through stock-ledger.ts applyMovements()
// inside their own transactions (a plain function, not a provider).
// I3: also exports InventoryReportsService so Dashboard (and any future
// Reports module) can call lowStockSummary() instead of re-deriving the
// low-stock rule from raw tables (CLAUDE.md rule 11).
// I5: goods receipts + production output (own controllers under
// /inventory/goods-receipts and /inventory/production-outputs) — still no
// module imports; Supplier/Purchase/Employee/Item are read-only lookups.
// I6: stock counts (own controller under /inventory/stock-counts) — same
// no-new-imports shape; StockCountsService only reads Item/StockBatch for
// existence checks.
// I8: goods returns (own controller under /inventory/goods-returns) — same
// no-new-imports shape; GoodsReturnsService only reads Supplier/GoodsReceipt/
// PurchaseReturn for existence checks (the latter two read-only, no FK).
@Module({
  controllers: [
    InventoryController,
    InventoryAdminController,
    InventoryReportsController,
    GoodsReceiptsController,
    ProductionOutputsController,
    StockCountsController,
    GoodsReturnsController,
  ],
  providers: [
    GoodsReceiptsRestorer, ProductionOutputsRestorer, StockAdjustmentsRestorer, StockCountsRestorer, GoodsReturnsRestorer,
    InventoryService,
    StockAdjustmentsService,
    StockLevelsService,
    InventoryReportsService,
    InventoryItemSettingsService,
    GoodsReceiptsService,
    ProductionOutputsService,
    StockCountsService,
    GoodsReturnsService,
  ],
  exports: [InventoryService, InventoryReportsService],
})
export class InventoryModule {}
