import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { createPurchaseTypeSchema, type CreatePurchaseTypeDto } from './dto/purchase-type.dto';
import { PurchaseTypesService } from './purchase-types.service';

@Controller('purchase-types')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchaseTypesController {
  constructor(private readonly purchaseTypesService: PurchaseTypesService) {}

  @Get()
  list() {
    return this.purchaseTypesService.list();
  }

  // Suggested code for a new record — declared before any ':id' route.
  @Get('next-code')
  @RequirePermissions('purchases.manage')
  nextCode() {
    return this.purchaseTypesService.nextCode();
  }

  // Backs the small "+ add purchase type" affordance on the Purchase form —
  // reuses purchases.manage rather than a dedicated permission, since this
  // isn't a standalone admin module (see purchase-type.dto.ts).
  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createPurchaseTypeSchema)) dto: CreatePurchaseTypeDto, @Req() req: Request) {
    return this.purchaseTypesService.create(dto, req.session.userId ?? null, req.ip);
  }
}
