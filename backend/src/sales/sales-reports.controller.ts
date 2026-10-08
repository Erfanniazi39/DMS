import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SalesReportsService } from './sales-reports.service';
import { salesReportPeriodQuerySchema, type SalesReportPeriodQuery } from './dto/sales-reports.dto';

// Read-only Sales reports (build plan §6/§8, Batch 7) — every route is
// gated on sales.view, the same permission that already gates viewing Sales
// Orders/Invoices: these reports show nothing a sales.view holder couldn't
// already piece together from the underlying documents. Deliberately NOT
// reports.view — that permission isn't wired to any backend endpoint
// anywhere else in this codebase; adding it here would be a separate,
// bigger decision about role-seeding, not this batch's job.
@Controller('sales/reports')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesReportsController {
  constructor(private readonly reports: SalesReportsService) {}

  @Get('backlog')
  @RequirePermissions('sales.view')
  backlog() {
    return this.reports.getBacklog();
  }

  @Get('by-item')
  @RequirePermissions('sales.view')
  byItem(@Query(new ZodValidationPipe(salesReportPeriodQuerySchema)) query: SalesReportPeriodQuery) {
    return this.reports.getSalesByItem(query);
  }

  @Get('by-customer')
  @RequirePermissions('sales.view')
  byCustomer(@Query(new ZodValidationPipe(salesReportPeriodQuerySchema)) query: SalesReportPeriodQuery) {
    return this.reports.getSalesByCustomer(query);
  }

  @Get('daily-summary')
  @RequirePermissions('sales.view')
  dailySummary(@Query(new ZodValidationPipe(salesReportPeriodQuerySchema)) query: SalesReportPeriodQuery) {
    return this.reports.getDailySummary(query);
  }
}
