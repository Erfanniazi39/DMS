import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';

// Imports nothing (PrismaModule and AuditModule are global). Exports
// InventoryService so the later Sales/Returns modules can read availability;
// stock writes from those modules go through stock-ledger.ts applyMovements()
// inside their own transactions (a plain function, not a provider).
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockAdjustmentsService],
  exports: [InventoryService],
})
export class InventoryModule {}
