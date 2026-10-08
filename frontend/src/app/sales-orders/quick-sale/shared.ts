// Shared types for the quick-sale screen (B6 — counter/cash sales). Mirrors
// backend src/receivables/dto/quick-sale.dto.ts /
// src/receivables/quick-sale.service.ts. Not a route: no page.tsx name.

export const QUICK_SALE_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD"] as const;
export type QuickSalePaymentMethod = (typeof QUICK_SALE_PAYMENT_METHODS)[number];

export const quickSalePaymentMethodLabels: Record<QuickSalePaymentMethod, string> = {
  CASH: "نقدی",
  BANK_TRANSFER: "انتقال بانکی",
  CARD: "کارت‌خوان",
};

// POST /quick-sale (sales.manage) response.
export type QuickSaleResult = {
  order: { id: number; orderNumber: string | null };
  delivery: { id: number; deliveryNumber: string | null };
  invoice: { id: number; invoiceNumber: string | null };
  payment: { id: number; paymentNumber: string };
};
