import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createPurchaseRequestSchema,
  updatePurchaseRequestSchema,
  type CreatePurchaseRequestDto,
  type UpdatePurchaseRequestDto,
} from './dto/purchase-request.dto';
import { PurchaseRequestsService } from './purchase-requests.service';

@Controller('purchase-requests')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequestsService: PurchaseRequestsService) {}

  @Get()
  @RequirePermissions('purchases.view')
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('requesterDepartmentId') requesterDepartmentId?: string,
  ) {
    return this.purchaseRequestsService.list({
      q: q || undefined,
      status: status || undefined,
      priority: priority || undefined,
      requesterDepartmentId: requesterDepartmentId ? Number(requesterDepartmentId) : undefined,
    });
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
