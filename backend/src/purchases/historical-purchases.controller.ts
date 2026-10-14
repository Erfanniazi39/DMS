import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { HistoricalPurchasesService } from './historical-purchases.service';
import { createHistoricalPurchasesSchema, type CreateHistoricalPurchasesDto } from './dto/historical-purchases.dto';

// Creating a purchase and recording its payment are both purchases.manage
// (the same gate as POST /purchases and POST /purchases/:id/payments).
@Controller('historical-purchases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class HistoricalPurchasesController {
  constructor(private readonly historicalPurchases: HistoricalPurchasesService) {}

  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createHistoricalPurchasesSchema)) dto: CreateHistoricalPurchasesDto, @Req() req: Request) {
    return this.historicalPurchases.createBatch(dto, req.session.userId ?? null, req.ip);
  }
}
