// Shared types for the Sales reports page (backend sales/sales-reports.*,
// Batch 7). Not a route: this file has no page.tsx/layout.tsx name.

export type ReportPeriodKey = "today" | "week" | "month" | "custom";

export const REPORT_PERIOD_OPTIONS: { key: ReportPeriodKey; label: string }[] = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "custom", label: "بازه دلخواه" },
];

// GET /sales/reports/backlog — not period-scoped (current open orders only).
export type BacklogLine = {
  id: number;
  lineNo: number;
  itemId: number;
  itemName: string;
  unitName: string;
  remainingQty: string;
  remainingValue: string;
};

export type BacklogOrder = {
  id: number;
  orderNumber: string | null;
  orderDate: string;
  customer: { id: number; customerNumber: string; name: string };
  lines: BacklogLine[];
  totalRemainingValue: string;
};

// GET /sales/reports/by-item
export type SalesByItemRow = {
  item: { id: number; code: string; name: string; unit: { nameFa: string } | null };
  quantity: string;
  revenue: string;
  invoiceLineCount: number;
};

export type SalesByItemResponse = {
  period: { key: ReportPeriodKey; from: string; to: string };
  rows: SalesByItemRow[];
};

// GET /sales/reports/by-customer
export type SalesByCustomerRow = {
  customer: { id: number; customerNumber: string; name: string };
  quantity: string;
  revenue: string;
  invoiceCount: number;
};

export type SalesByCustomerResponse = {
  period: { key: ReportPeriodKey; from: string; to: string };
  rows: SalesByCustomerRow[];
};

// GET /sales/reports/daily-summary
export type DailyTrendPoint = {
  date: string;
  confirmedOrderAmount: string;
  confirmedOrderCount: number;
  invoicedAmount: string;
  invoicedCount: number;
  paymentAmount: string;
  paymentCount: number;
};

export type DailySummaryResponse = {
  period: { key: ReportPeriodKey; from: string; to: string; bucket: "day" | "week" };
  trend: DailyTrendPoint[];
};

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
