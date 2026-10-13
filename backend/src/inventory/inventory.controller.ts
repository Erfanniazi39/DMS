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
  approveStockAdjustmentSchema,
  availabilityQuerySchema,
  createLocationSchema,
  createStockAdjustmentSchema,
  itemBatchesQuerySchema,
  postStockAdjustmentSchema,
  rejectStockAdjustmentSchema,
  stockAdjustmentListQuerySchema,
  stockBalanceListQuerySchema,
  stockCardQuerySchema,
  stockMovementListQuerySchema,
  submitStockAdjustmentSchema,
  updateLocationSchema,
  updateStockAdjustmentSchema,
  type ApproveStockAdjustmentDto,
  type AvailabilityQuery,
  type CreateLocationDto,
  type CreateStockAdjustmentDto,
  type ItemBatchesQuery,
  type PostStockAdjustmentDto,
  type RejectStockAdjustmentDto,
  type StockAdjustmentListQuery,
  type StockBalanceListQuery,
  type StockCardQuery,
  type StockMovementListQuery,
  type UpdateLocationDto,
  type SubmitStockAdjustmentDto,
  type UpdateStockAdjustmentDto,
} from './dto/inventory.dto';

// Reading anything here needs inventory.view; creating/editing/posting/
// submitting/deleting a stock adjustment needs inventory.adjust.
// Approving/rejecting a PENDING_APPROVAL document (I2, B10/B20) needs
// inventory.approve instead — WAREHOUSE never gets this permission.
@Controller('inventory')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly adjustmentsService: StockAdjustmentsService,
  ) {}

  // Listing needs only inventory.view (it backs every location picker);
  // create/update are admin-level, gated by inventory.manage like
  // stock-levels/item-settings/integrity.
  @Get('locations')
  @RequirePermissions('inventory.view')
  listLocations() {
    return this.inventoryService.listLocations();
  }

  @Post('locations')
  @RequirePermissions('inventory.manage')
  createLocation(@Body(new ZodValidationPipe(createLocationSchema)) dto: CreateLocationDto, @Req() req: Request) {
    return this.inventoryService.createLocation(dto, req.session.userId ?? null, req.ip);
  }

  // Declared after the plain GET/POST above but before any ':id'-shaped
  // sibling route in this controller — none currently collides, but kept
  // explicit since ParseIntPipe would otherwise swallow a literal segment.
  @Patch('locations/:id')
  @RequirePermissions('inventory.manage')
  updateLocation(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateLocationSchema)) dto: UpdateLocationDto, @Req() req: Request) {
    return this.inventoryService.updateLocation(id, dto, req.session.userId ?? null, req.ip);
  }

  // Stock list. page/pageSize opt-in (parsePagination) — omitted = full array.
  @Get('balances')
  @RequirePermissions('inventory.view')
  listBalances(@Query(new ZodValidationPipe(stockBalanceListQuerySchema)) query: StockBalanceListQuery) {
    return this.inventoryService.listBalances(
      {
        q: query.q?.trim() || undefined,
        locationId: query.locationId,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        lowStockOnly: query.lowStockOnly === 'true',
      },
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

  // I4 (build plan §5.4/§16 resume step 7): every batch of one item that
  // still carries stock, with its expiry status — the batch picker/expiry
  // view for an item's detail page.
  @Get('items/:itemId/batches')
  @RequirePermissions('inventory.view')
  listItemBatches(@Param('itemId', ParseIntPipe) itemId: number, @Query(new ZodValidationPipe(itemBatchesQuerySchema)) query: ItemBatchesQuery) {
    return this.inventoryService.listItemBatches(itemId, query.locationId);
  }

  // Stock card (کاردکس): every movement for one item, across locations,
  // with a running balance per bucket (I1, build plan §9).
  @Get('items/:itemId/stock-card')
  @RequirePermissions('inventory.view')
  getStockCard(@Param('itemId', ParseIntPipe) itemId: number, @Query(new ZodValidationPipe(stockCardQuerySchema)) query: StockCardQuery) {
    return this.inventoryService.getStockCard(itemId, { locationId: query.locationId });
  }

  // Movement browser (/inventory/movements): a filterable, paginated view
  // over the ledger (I1, build plan §9).
  @Get('movements')
  @RequirePermissions('inventory.view')
  listMovements(@Query(new ZodValidationPipe(stockMovementListQuerySchema)) query: StockMovementListQuery) {
    return this.inventoryService.listMovements(
      {
        itemId: query.itemId,
        locationId: query.locationId,
        bucket: query.bucket,
        movementType: query.movementType,
        referenceType: query.referenceType,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Moved to InventoryAdminController (I3): inventory.manage now exists as
  // "admin-level inventory configuration" and is the correct gate — see
  // inventory-admin.controller.ts's checkIntegrity().

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

  // DRAFT → PENDING_APPROVAL: only for a kind/net-quantity that needs
  // inventory.approve (B10). post() refuses these; this is the only route in.
  @Post('stock-adjustments/:id/submit')
  @RequirePermissions('inventory.adjust')
  submitAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(submitStockAdjustmentSchema)) dto: SubmitStockAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustmentsService.submit(id, dto.updatedAt, req.session.userId ?? null, req.ip);
  }

  // PENDING_APPROVAL → POSTED. No self-approval: the approver must not be
  // the user who submitted (service enforces this; see StockAdjustmentsService).
  @Post('stock-adjustments/:id/approve')
  @RequirePermissions('inventory.approve')
  approveAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(approveStockAdjustmentSchema)) dto: ApproveStockAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustmentsService.approve(id, dto.updatedAt, req.session.userId ?? null, req.ip);
  }

  // PENDING_APPROVAL → DRAFT, with a required reason.
  @Post('stock-adjustments/:id/reject')
  @RequirePermissions('inventory.approve')
  rejectAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(rejectStockAdjustmentSchema)) dto: RejectStockAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustmentsService.reject(id, dto.updatedAt, dto.rejectReason, req.session.userId ?? null, req.ip);
  }
}
