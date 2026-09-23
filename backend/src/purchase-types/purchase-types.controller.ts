import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  // Backs the small "+ add purchase type" affordance on the Purchase form —
  // reuses purchases.manage rather than a dedicated permission, since this
  // isn't a standalone admin module (see purchase-type.dto.ts).
  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createPurchaseTypeSchema)) dto: CreatePurchaseTypeDto) {
    return this.purchaseTypesService.create(dto);
  }
}
