import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RequireFeature } from '../common/feature-flags';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { expiryReportQuerySchema, type ExpiryReportQuery } from './dto/item-setting.dto';
import { lowStockQuerySchema, type LowStockQuery } from './dto/stock-level.dto';
import { InventoryReportsService } from './inventory-reports.service';

// Read-only Inventory reports (build plan §9's /inventory/reports/*).
// Gated on inventory.view — reading a report needs less than editing the
// thresholds it's based on (inventory.manage), per B14.
@Controller('inventory/reports')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class InventoryReportsController {
  constructor(private readonly reportsService: InventoryReportsService) {}

  @Get('low-stock')
  @RequirePermissions('inventory.view')
  lowStock(@Query(new ZodValidationPipe(lowStockQuerySchema)) query: LowStockQuery) {
    return this.reportsService.lowStockSummary({ locationId: query.locationId });
  }

  // I4 (build plan §5.4/§16 resume step 7): which dated batches are
  // expiring soon or have already expired.
  @Get('expiry')
  @RequireFeature('inventoryBatchTracking')
  @RequirePermissions('inventory.view')
  expiry(@Query(new ZodValidationPipe(expiryReportQuerySchema)) query: ExpiryReportQuery) {
    return this.reportsService.expiryReport({ withinDays: query.withinDays, includeExpired: query.includeExpired === 'true' });
  }
}
