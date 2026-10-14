import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { HistoricalSalesService } from './historical-sales.service';
import type { QuickSaleActor } from './quick-sale.service';
import { createHistoricalSalesSchema, type CreateHistoricalSalesDto } from './dto/historical-sales.dto';

// Same actor shape as QuickSaleController. The chain creates orders,
// deliveries, invoices and receipts, so the caller needs every one of those
// write permissions (all required — the permissions guard is AND).
function actorOf(req: Request): QuickSaleActor {
  const permissions = req.session?.permissions ?? [];
  const canApprove = permissions.includes('sales.approve');
  // 'bypass': past records are never held for workflow approval.
  return { userId: req.session.userId ?? null, ipAddress: req.ip, canApprove, canViewCredit: canApprove || permissions.includes('customers.finance'), workflow: 'bypass' };
}

@Controller('historical-sales')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class HistoricalSalesController {
  constructor(private readonly historicalSales: HistoricalSalesService) {}

  @Post()
  @RequirePermissions('sales.manage', 'sales.deliver', 'sales.invoice', 'receivables.manage')
  create(@Body(new ZodValidationPipe(createHistoricalSalesSchema)) dto: CreateHistoricalSalesDto, @Req() req: Request) {
    return this.historicalSales.createBatch(dto, actorOf(req));
  }
}
