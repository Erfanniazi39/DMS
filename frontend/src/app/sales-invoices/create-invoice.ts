import { apiFetch, type ApiError } from "@/lib/api";
import { SALES_INVOICE_DRAFT_EXISTS, type SalesInvoiceDetail } from "./shared";

// One-click «ایجاد فاکتور» for a POSTED delivery (queue row, delivery
// detail): POST /sales-invoices { deliveryId } (sales.invoice) — the backend
// prefills every uninvoiced delivery line and dates the invoice today.
// Resolves to the id of the invoice to open: the new draft, or — when the
// delivery already has a draft (409 SALES_INVOICE_DRAFT_EXISTS, B7: one
// invoice per delivery) — that existing draft. Any other error is rethrown.
export async function createInvoiceFromDelivery(deliveryId: number): Promise<number> {
  try {
    const created = await apiFetch<SalesInvoiceDetail>("/sales-invoices", { method: "POST", body: JSON.stringify({ deliveryId }) });
    return created.id;
  } catch (reason) {
    const error = reason as ApiError;
    const existing = (error.details as { salesInvoiceId?: unknown } | undefined)?.salesInvoiceId;
    if (error.code === SALES_INVOICE_DRAFT_EXISTS && typeof existing === "number") return existing;
    throw error;
  }
}
