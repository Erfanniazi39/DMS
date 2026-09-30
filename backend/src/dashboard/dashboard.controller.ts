import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { purchasesSummaryQuerySchema, type PurchasesSummaryQueryDto } from './dto/purchases-summary.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // purchases.manage, not reports.view: it's the permission the dashboard's
  // purchase KPIs, trend chart and transactions table are already gated on
  // in the frontend, and the one every role that actually works with
  // purchase money holds. reports.view belongs to the not-yet-built Reports
  // module and is not used by any backend endpoint yet.
  @Get('purchases-summary')
  @RequirePermissions('purchases.manage')
  purchasesSummary(@Query(new ZodValidationPipe(purchasesSummaryQuerySchema)) query: PurchasesSummaryQueryDto) {
    return this.dashboardService.getPurchasesSummary(query);
  }

  // Same gate as purchases-summary: the feed only covers Purchase and
  // PurchaseRequest audit entries (see DashboardService.getRecentActivity).
  @Get('recent-activity')
  @RequirePermissions('purchases.manage')
  recentActivity() {
    return this.dashboardService.getRecentActivity();
  }
}
