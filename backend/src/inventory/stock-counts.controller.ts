import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { CountAccess } from './stock-counts.service';
import { StockCountsService } from './stock-counts.service';
import {
  approveStockCountSchema,
  cancelStockCountSchema,
  createStockCountSchema,
  enterStockCountSchema,
  requestRecountStockCountSchema,
  startStockCountSchema,
  stockCountListQuerySchema,
  submitStockCountSchema,
  updateStockCountSchema,
  type ApproveStockCountDto,
  type CancelStockCountDto,
  type CreateStockCountDto,
  type EnterStockCountDto,
  type RequestRecountStockCountDto,
  type StartStockCountDto,
  type StockCountListQuery,
  type SubmitStockCountDto,
  type UpdateStockCountDto,
} from './dto/stock-count.dto';

// B13: systemQty/varianceQty are visible while a blind count is COUNTING
// only to a caller holding inventory.approve. Same "flag from the session,
// decide in the service" pattern as GoodsReceiptsController's costAccessOf.
export function countAccessOf(req: Request): CountAccess {
  return { canSeeSystemQty: (req.session?.permissions ?? []).includes('inventory.approve') };
}

// Stock counts (شمارش موجودی) — Inventory batch I6, build plan §5.6/§6/§7.
// Reading needs inventory.view. Create/edit/delete/start/enter/submit/cancel
// need inventory.count (the counting role). Approve/requestRecount need
// inventory.approve (the approving role, never the submitter — B10 reused).
@Controller('inventory/stock-counts')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class StockCountsController {
  constructor(private readonly countsService: StockCountsService) {}

  // Declared before ':id' so it isn't captured by ParseIntPipe.
  @Get('form-options')
  @RequirePermissions('inventory.count')
  formOptions() {
    return this.countsService.formOptions();
  }

  @Get()
  @RequirePermissions('inventory.view')
  list(@Query(new ZodValidationPipe(stockCountListQuerySchema)) query: StockCountListQuery) {
    return this.countsService.list(
      { q: query.q?.trim() || undefined, status: query.status, scope: query.scope, locationId: query.locationId },
      parsePagination(query.page, query.pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.countsService.get(id, countAccessOf(req));
  }

  @Post()
  @RequirePermissions('inventory.count')
  create(@Body(new ZodValidationPipe(createStockCountSchema)) dto: CreateStockCountDto, @Req() req: Request) {
    return this.countsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('inventory.count')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateStockCountSchema)) dto: UpdateStockCountDto, @Req() req: Request) {
    return this.countsService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  // DRAFT → COUNTING: snapshots systemQty per line (FULL scope populates the
  // lines first, from real stock balances).
  @Post(':id/start')
  @RequirePermissions('inventory.count')
  start(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(startStockCountSchema)) dto: StartStockCountDto, @Req() req: Request) {
    return this.countsService.start(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // Records countedQty per line while COUNTING. Blind: the response never
  // carries systemQty/varianceQty unless the caller holds inventory.approve.
  @Post(':id/enter-count')
  @RequirePermissions('inventory.count')
  enterCount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(enterStockCountSchema)) dto: EnterStockCountDto, @Req() req: Request) {
    return this.countsService.enterCount(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // COUNTING → REVIEW: every line must already have a countedQty.
  @Post(':id/submit')
  @RequirePermissions('inventory.count')
  submit(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(submitStockCountSchema)) dto: SubmitStockCountDto, @Req() req: Request) {
    return this.countsService.submit(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // REVIEW → POSTED: stale check first (409 COUNT_STALE), then posts
  // COUNT_GAIN/COUNT_LOSS for every variance line. Never the submitter (B10).
  @Post(':id/approve')
  @RequirePermissions('inventory.approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(approveStockCountSchema)) dto: ApproveStockCountDto, @Req() req: Request) {
    return this.countsService.approve(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // REVIEW → COUNTING for the selected lines only — un-stales them before a
  // retry at approve().
  @Post(':id/request-recount')
  @RequirePermissions('inventory.approve')
  requestRecount(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(requestRecountStockCountSchema)) dto: RequestRecountStockCountDto,
    @Req() req: Request,
  ) {
    return this.countsService.requestRecount(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT/COUNTING/REVIEW → CANCELLED. Reason required.
  @Post(':id/cancel')
  @RequirePermissions('inventory.count')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(cancelStockCountSchema)) dto: CancelStockCountDto, @Req() req: Request) {
    return this.countsService.cancel(id, dto, countAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT only — a count that has ever been started keeps its history
  // (cancel() instead).
  @Delete(':id')
  @RequirePermissions('inventory.count')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.countsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
