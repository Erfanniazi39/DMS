import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parsePagination } from '../common/pagination';
import { requiredId } from '../common/zod-fields';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { GoodsReturnsService } from './goods-returns.service';
import {
  createGoodsReturnSchema,
  goodsReturnListQuerySchema,
  postGoodsReturnSchema,
  updateGoodsReturnSchema,
  type CreateGoodsReturnDto,
  type GoodsReturnListQuery,
  type PostGoodsReturnDto,
  type UpdateGoodsReturnDto,
} from './dto/goods-return.dto';

const goodsReceiptOptionsQuerySchema = z.object({ supplierId: requiredId('تأمین‌کننده را انتخاب کنید') });

// Goods returns (برگشت کالا به تأمین‌کننده) — Inventory batch I8, build plan
// §5.8/§6/§7, B9. Reading needs inventory.view; create/edit/delete/post and
// the form pickers need inventory.receive — the same permission already
// documented as "Goods receipts, QC release, goods returns" (no new
// permission).
@Controller('inventory/goods-returns')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class GoodsReturnsController {
  constructor(private readonly returnsService: GoodsReturnsService) {}

  // Declared before ':id' so they aren't captured by ParseIntPipe.
  @Get('form-options')
  @RequirePermissions('inventory.receive')
  formOptions() {
    return this.returnsService.formOptions();
  }

  @Get('goods-receipt-options')
  @RequirePermissions('inventory.receive')
  goodsReceiptOptions(@Query(new ZodValidationPipe(goodsReceiptOptionsQuerySchema)) query: { supplierId: number }) {
    return this.returnsService.goodsReceiptOptions(query.supplierId);
  }

  @Get()
  @RequirePermissions('inventory.view')
  list(@Query(new ZodValidationPipe(goodsReturnListQuerySchema)) query: GoodsReturnListQuery) {
    return this.returnsService.list(
      { q: query.q?.trim() || undefined, status: query.status, supplierId: query.supplierId },
      parsePagination(query.page, query.pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.returnsService.get(id);
  }

  @Post()
  @RequirePermissions('inventory.receive')
  create(@Body(new ZodValidationPipe(createGoodsReturnSchema)) dto: CreateGoodsReturnDto, @Req() req: Request) {
    return this.returnsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('inventory.receive')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateGoodsReturnSchema)) dto: UpdateGoodsReturnDto, @Req() req: Request) {
    return this.returnsService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  // DRAFT → POSTED: assigns GRT-<year>-NNNNNN and writes SUPPLIER_RETURN
  // movements out of each line's own fromBucket.
  @Post(':id/post')
  @RequirePermissions('inventory.receive')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postGoodsReturnSchema)) dto: PostGoodsReturnDto, @Req() req: Request) {
    return this.returnsService.post(id, dto.updatedAt, req.session.userId ?? null, req.ip);
  }

  // DRAFT only — a posted return can never be deleted.
  @Delete(':id')
  @RequirePermissions('inventory.receive')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.returnsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
