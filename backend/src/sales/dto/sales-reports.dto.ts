// Query schema for the Sales reports endpoints (Batch 7). Reuses the
// dashboard's generic "today/week/month/custom" period resolution verbatim
// (dashboard/dto/purchases-summary.dto.ts's schema + dashboard.service.ts's
// resolvePeriodRange) instead of reinventing date-bucketing logic — that
// schema only encodes a calendar-period shape, not a Purchases business
// rule, so importing it here is plain code sharing, not a CLAUDE.md rule 11
// module-boundary cross (no NestJS module import/DI is involved).
import { purchasesSummaryQuerySchema, type PurchasesSummaryQueryDto } from '../../dashboard/dto/purchases-summary.dto';

export const salesReportPeriodQuerySchema = purchasesSummaryQuerySchema;
export type SalesReportPeriodQuery = PurchasesSummaryQueryDto;
