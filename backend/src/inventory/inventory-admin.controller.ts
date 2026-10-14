import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RequireFeature } from '../common/feature-flags';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { upsertInventoryItemSettingSchema, type UpsertInventoryItemSettingDto } from './dto/item-setting.dto';
import {
  stockLevelListQuerySchema,
  upsertStockLevelSchema,
  type StockLevelListQuery,
  type UpsertStockLevelDto,
} from './dto/stock-level.dto';
import { InventoryItemSettingsService } from './inventory-item-settings.service';
import { InventoryService } from './inventory.service';
import { StockLevelsService } from './stock-levels.service';

// Admin-level inventory configuration (build plan §8): stock levels and
// per-item batch/expiry settings (I4) today; locations/batch-correction join
// as later batches land. Everything here is gated on inventory.manage —
// never granted to WAREHOUSE or SALES_MANAGER (editing thresholds, the
// integrity diagnostic, and batch-tracking configuration are manager-level
// config, not day-to-day warehouse work).
@Controller('inventory')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class InventoryAdminController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockLevelsService: StockLevelsService,
    private readonly itemSettingsService: InventoryItemSettingsService,
  ) {}

  // Ledger-vs-balance integrity check (I1, build plan §2.3 finding 4), moved
  // here from InventoryController (I3): inventory.manage now exists as
  // "admin-level inventory configuration" and is the correct gate —
  // inventory.adjust was only ever a stand-in until this permission existed.
  // WAREHOUSE (inventory.adjust only) loses access; INVENTORY_MANAGER
  // (now also holding inventory.manage) keeps it.
  @Get('integrity')
  @RequirePermissions('inventory.manage')
  checkIntegrity() {
    return this.inventoryService.verifyBalances();
  }

  @Get('stock-levels')
  @RequirePermissions('inventory.manage')
  listStockLevels(@Query(new ZodValidationPipe(stockLevelListQuerySchema)) query: StockLevelListQuery) {
    return this.stockLevelsService.list({ q: query.q?.trim() || undefined, locationId: query.locationId });
  }

  @Get('stock-levels/:id')
  @RequirePermissions('inventory.manage')
  getStockLevel(@Param('id', ParseIntPipe) id: number) {
    return this.stockLevelsService.get(id);
  }

  // Upsert keyed by (itemId, locationId) — see StockLevelsService's class
  // comment. One endpoint handles both "set a new threshold" and "edit an
  // existing one", matching the grid editor's per-row save.
  @Post('stock-levels')
  @RequirePermissions('inventory.manage')
  upsertStockLevel(@Body(new ZodValidationPipe(upsertStockLevelSchema)) dto: UpsertStockLevelDto, @Req() req: Request) {
    return this.stockLevelsService.upsert(dto, req.session.userId ?? null, req.ip);
  }

  // Clears a threshold entirely — the item+location goes back to "no
  // threshold set" (never flagged as low, per B14).
  @Delete('stock-levels/:id')
  @RequirePermissions('inventory.manage')
  removeStockLevel(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.stockLevelsService.remove(id, req.session.userId ?? null, req.ip);
  }

  // I4 (build plan §5.4/§5.4a): per-item batch/expiry configuration.
  @Get('item-settings/:itemId')
  @RequireFeature('inventoryBatchTracking')
  @RequirePermissions('inventory.manage')
  getItemSetting(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.itemSettingsService.get(itemId);
  }

  @Put('item-settings/:itemId')
  @RequireFeature('inventoryBatchTracking')
  @RequirePermissions('inventory.manage')
  upsertItemSetting(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(upsertInventoryItemSettingSchema)) dto: UpsertInventoryItemSettingDto,
    @Req() req: Request,
  ) {
    return this.itemSettingsService.upsert(itemId, dto, req.session.userId ?? null, req.ip);
  }
}
