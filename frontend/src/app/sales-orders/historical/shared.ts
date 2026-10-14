// Types for the historical-sales entry screen. Mirrors backend
// src/receivables/dto/historical-sales.dto.ts and historical-sales.service.ts.
// Not a route: no page.tsx name.

export type HistoricalPaymentMode = "FULL" | "PARTIAL" | "NONE";

export const historicalPaymentModeLabels: Record<HistoricalPaymentMode, string> = {
  FULL: "پرداخت کامل",
  PARTIAL: "پرداخت جزئی",
  NONE: "پرداخت‌نشده",
};

// POST /historical-sales response — one result per submitted row, same order.
export type HistoricalSaleResult =
  | {
      index: number;
      ok: true;
      order: { id: number; orderNumber: string | null };
      delivery: { id: number; deliveryNumber: string | null };
      invoice: { id: number; invoiceNumber: string | null };
      payment: { id: number; paymentNumber: string } | null;
    }
  | { index: number; ok: false; errors: string[] };
