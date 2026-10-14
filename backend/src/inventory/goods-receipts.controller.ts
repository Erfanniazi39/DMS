import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parsePagination, parseSort } from '../common/pagination';
import { requiredId } from '../common/zod-fields';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { GoodsReceiptsService } from './goods-receipts.service';
import type { CostAccess } from './inbound-documents';
import {
  createGoodsReceiptSchema,
  goodsReceiptListQuerySchema,
  postGoodsReceiptSchema,
  releaseGoodsReceiptQcSchema,
  updateGoodsReceiptSchema,
  type CreateGoodsReceiptDto,
  type GoodsReceiptListQuery,
  type PostGoodsReceiptDto,
  type ReleaseGoodsReceiptQcDto,
  type UpdateGoodsReceiptDto,
} from './dto/goods-receipt.dto';

const purchaseOptionsQuerySchema = z.object({ supplierId: requiredId('تأمین‌کننده را انتخاب کنید') });

// B15: cost (unitCost) is visible/settable only with inventory.cost. Same
// "flag from the session, decided in the service" pattern as
// CustomersController's canViewSensitive.
export function costAccessOf(req: Request): CostAccess {
  return { canViewCost: (req.session?.permissions ?? []).includes('inventory.cost') };
}

// Goods receipts (رسید انبار) — Inventory batch I5, build plan §5.5/§6/§7.
// Reading needs inventory.view; create/edit/delete/post/QC-release need
// inventory.receive. Costs in responses are masked unless inventory.cost.
@Controller('inventory/goods-receipts')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class GoodsReceiptsController {
  constructor(private readonly receiptsService: GoodsReceiptsService) {}

  // Declared before ':id' so they aren't captured by ParseIntPipe.
  @Get('form-options')
  @RequirePermissions('inventory.receive')
  formOptions() {
    return this.receiptsService.formOptions();
  }

  @Get('purchase-options')
  @RequirePermissions('inventory.receive')
  purchaseOptions(@Query(new ZodValidationPipe(purchaseOptionsQuerySchema)) query: { supplierId: number }) {
    return this.receiptsService.purchaseOptions(query.supplierId);
  }

  @Get()
  @RequirePermissions('inventory.view')
  list(@Query(new ZodValidationPipe(goodsReceiptListQuerySchema)) query: GoodsReceiptListQuery) {
    return this.receiptsService.list(
      { q: query.q?.trim() || undefined, status: query.status, supplierId: query.supplierId, sort: parseSort(query.sortBy, query.sortDir) },
      parsePagination(query.page, query.pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.receiptsService.get(id, costAccessOf(req));
  }

  @Post()
  @RequirePermissions('inventory.receive')
  create(@Body(new ZodValidationPipe(createGoodsReceiptSchema)) dto: CreateGoodsReceiptDto, @Req() req: Request) {
    return this.receiptsService.create(dto, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('inventory.receive')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateGoodsReceiptSchema)) dto: UpdateGoodsReceiptDto, @Req() req: Request) {
    return this.receiptsService.update(id, dto, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT → POSTED: assigns GRN-<year>-NNNNNN and writes GOODS_RECEIPT
  // movements (ON_HAND, or QC when inspectionRequired).
  @Post(':id/post')
  @RequirePermissions('inventory.receive')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postGoodsReceiptSchema)) dto: PostGoodsReceiptDto, @Req() req: Request) {
    return this.receiptsService.post(id, dto.updatedAt, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // B19: QC → ON_HAND for a POSTED, inspectionRequired receipt, per line.
  @Post(':id/release-qc')
  @RequirePermissions('inventory.receive')
  releaseQc(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(releaseGoodsReceiptQcSchema)) dto: ReleaseGoodsReceiptQcDto, @Req() req: Request) {
    return this.receiptsService.releaseFromQc(id, dto, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT only — a posted receipt can never be deleted.
  @Delete(':id')
  @RequirePermissions('inventory.receive')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.receiptsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
