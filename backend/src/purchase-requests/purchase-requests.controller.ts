import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination, parseSort } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createPurchaseRequestSchema,
  purchaseRequestApprovalDecisionSchema,
  purchaseRequestApprovalRejectSchema,
  purchaseRequestListQuerySchema,
  updatePurchaseRequestSchema,
  type CreatePurchaseRequestDto,
  type PurchaseRequestApprovalDecisionDto,
  type PurchaseRequestApprovalRejectDto,
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
      sort: parseSort(query.sortBy, query.sortDir),
    }, pagination);
  }

  @Get(':id')
  @RequirePermissions('purchases.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.purchaseRequestsService.getDetail(id, req.session.userId ?? null);
  }

  // Workflow approval actions. approve/reject need only purchases.view — who
  // may decide comes from the approval rule (checked by the engine against the
  // DB). withdraw: the requester, or any purchases.manage holder.
  @Post(':id/approve')
  @RequirePermissions('purchases.view')
  approve(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(purchaseRequestApprovalDecisionSchema)) dto: PurchaseRequestApprovalDecisionDto, @Req() req: Request) {
    return this.purchaseRequestsService.approve(id, dto, req.session.userId as number, req.ip);
  }

  @Post(':id/reject')
  @RequirePermissions('purchases.view')
  reject(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(purchaseRequestApprovalRejectSchema)) dto: PurchaseRequestApprovalRejectDto, @Req() req: Request) {
    return this.purchaseRequestsService.reject(id, dto, req.session.userId as number, req.ip);
  }

  @Post(':id/withdraw')
  @RequirePermissions('purchases.edit')
  withdraw(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(purchaseRequestApprovalDecisionSchema)) dto: PurchaseRequestApprovalDecisionDto, @Req() req: Request) {
    const canManage = (req.session.permissions ?? []).includes('purchases.manage');
    return this.purchaseRequestsService.withdraw(id, dto, req.session.userId as number, canManage, req.ip);
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
