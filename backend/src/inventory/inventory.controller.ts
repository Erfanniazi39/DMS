import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';
import {
  availabilityQuerySchema,
  createStockAdjustmentSchema,
  postStockAdjustmentSchema,
  stockAdjustmentListQuerySchema,
  stockBalanceListQuerySchema,
  updateStockAdjustmentSchema,
  type AvailabilityQuery,
  type CreateStockAdjustmentDto,
  type PostStockAdjustmentDto,
  type StockAdjustmentListQuery,
  type StockBalanceListQuery,
  type UpdateStockAdjustmentDto,
} from './dto/inventory.dto';

// Reading anything here needs inventory.view; creating/editing/posting/
// deleting a stock adjustment needs inventory.adjust.
@Controller('inventory')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly adjustmentsService: StockAdjustmentsService,
  ) {}

  // Read-only for now (single seeded warehouse, no management UI).
  @Get('locations')
  @RequirePermissions('inventory.view')
  listLocations() {
    return this.inventoryService.listLocations();
  }

  // Stock list. page/pageSize opt-in (parsePagination) — omitted = full array.
  @Get('balances')
  @RequirePermissions('inventory.view')
  listBalances(@Query(new ZodValidationPipe(stockBalanceListQuerySchema)) query: StockBalanceListQuery) {
    return this.inventoryService.listBalances(
      { q: query.q?.trim() || undefined, locationId: query.locationId, sortBy: query.sortBy, sortDir: query.sortDir },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Active items for the stock-adjustment form's item picker (the WAREHOUSE
  // role has inventory.adjust but not items.view). Plain array.
  @Get('item-options')
  @RequirePermissions('inventory.adjust')
  listItemOptions() {
    return this.inventoryService.listItemOptions();
  }

  // Authoritative availability (onHand − reserved) for one item; location
  // omitted = default warehouse.
  @Get('items/:itemId/availability')
  @RequirePermissions('inventory.view')
  async availability(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    const locationId = query.locationId ?? (await this.inventoryService.getDefaultLocation()).id;
    return this.inventoryService.getAvailability(itemId, locationId);
  }

  @Get('stock-adjustments')
  @RequirePermissions('inventory.view')
  listAdjustments(@Query(new ZodValidationPipe(stockAdjustmentListQuerySchema)) query: StockAdjustmentListQuery) {
    return this.adjustmentsService.list(
      { q: query.q?.trim() || undefined, status: query.status, kind: query.kind },
      parsePagination(query.page, query.pageSize),
    );
  }

  @Get('stock-adjustments/:id')
  @RequirePermissions('inventory.view')
  getAdjustment(@Param('id', ParseIntPipe) id: number) {
    return this.adjustmentsService.get(id);
  }

  @Post('stock-adjustments')
  @RequirePermissions('inventory.adjust')
  createAdjustment(@Body(new ZodValidationPipe(createStockAdjustmentSchema)) dto: CreateStockAdjustmentDto, @Req() req: Request) {
    return this.adjustmentsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch('stock-adjustments/:id')
  @RequirePermissions('inventory.adjust')
  updateAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateStockAdjustmentSchema)) dto: UpdateStockAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustmentsService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  // DRAFT → POSTED: assigns ADJ-<year>-NNNNNN and writes the stock movements.
  @Post('stock-adjustments/:id/post')
  @RequirePermissions('inventory.adjust')
  postAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(postStockAdjustmentSchema)) dto: PostStockAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustmentsService.post(id, dto.updatedAt, req.session.userId ?? null, req.ip);
  }

  // DRAFT only — a posted adjustment can never be deleted.
  @Delete('stock-adjustments/:id')
  @RequirePermissions('inventory.adjust')
  removeAdjustment(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.adjustmentsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
