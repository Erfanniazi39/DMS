import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { QuickSaleService, type QuickSaleActor } from './quick-sale.service';
import { createQuickSaleSchema, type CreateQuickSaleDto } from './dto/quick-sale.dto';

// B6 — counter/cash sales. Gated on sales.manage, same as creating a normal
// sales order: a quick sale goes through the exact same credit/stock/
// discount-permission checks as any order (QuickSaleService calls the real
// SalesOrdersService.confirm() etc.) — there is no exemption for "it's
// cash". A sales.approve holder's session also unlocks credit overrides the
// same way it would on /sales-orders/:id/confirm (actorOf mirrors
// SalesOrdersController's own).
function actorOf(req: Request): QuickSaleActor {
  const permissions = req.session?.permissions ?? [];
  const canApprove = permissions.includes('sales.approve');
  return { userId: req.session.userId ?? null, ipAddress: req.ip, canApprove, canViewCredit: canApprove || permissions.includes('customers.finance') };
}

@Controller('quick-sale')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class QuickSaleController {
  constructor(private readonly quickSale: QuickSaleService) {}

  @Post()
  @RequirePermissions('sales.manage')
  create(@Body(new ZodValidationPipe(createQuickSaleSchema)) dto: CreateQuickSaleDto, @Req() req: Request) {
    return this.quickSale.createQuickSale(dto, actorOf(req));
  }
}
