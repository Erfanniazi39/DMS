import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createPurchaseRequestSchema,
  purchaseRequestListQuerySchema,
  updatePurchaseRequestSchema,
  type CreatePurchaseRequestDto,
  type PurchaseRequestListQuery,
  type UpdatePurchaseRequestDto,
} from './dto/purchase-request.dto';
import { PurchaseRequestsService } from './purchase-requests.service';

@Controller('purchase-requests')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequestsService: PurchaseRequestsService) {}

  @Get()
  @RequirePermissions('purchases.view')
  // Filters validated by purchaseRequestListQuerySchema (?status=FOO → 400,
  // not a raw 500). page/pageSize: opt-in pagination — see
  // parsePagination(). Omitted = full array.
  list(@Query(new ZodValidationPipe(purchaseRequestListQuerySchema)) query: PurchaseRequestListQuery) {
    const pagination = parsePagination(query.page, query.pageSize);
    return this.purchaseRequestsService.list({
      q: query.q || undefined,
      status: query.status,
      priority: query.priority,
      requesterDepartmentId: query.requesterDepartmentId,
    }, pagination);
  }

  @Get(':id')
  @RequirePermissions('purchases.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseRequestsService.get(id);
  }

  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createPurchaseRequestSchema)) dto: CreatePurchaseRequestDto, @Req() req: Request) {
    return this.purchaseRequestsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('purchases.edit')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) dto: UpdatePurchaseRequestDto,
    @Req() req: Request,
  ) {
    return this.purchaseRequestsService.update(id, dto, req.session.userId ?? null, req.ip);
  }
}
