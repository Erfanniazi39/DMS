"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import type { SalesInvoiceHistoryEntry } from "../../shared";

// «تاریخچه» — GET /sales-invoices/:id/history (sales.view): the invoice's
// audit trail, newest first. Action codes from backend
// sales-invoices.service.ts.
const actionLabels: Record<string, string> = {
  SALES_INVOICE_CREATED: "ایجاد پیش‌نویس",
  SALES_INVOICE_DELETED: "حذف پیش‌نویس",
  SALES_INVOICE_POSTED: "ثبت فاکتور",
};

export function HistorySection({ invoiceId, reloadKey }: { invoiceId: number; reloadKey: number }) {
  const [entries, setEntries] = useState<SalesInvoiceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesInvoiceHistoryEntry[]>(`/sales-invoices/${invoiceId}/history`)
      .then((data) => {
        if (!ignore) {
          setEntries(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت تاریخچه ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [invoiceId, reloadKey, retryKey]);

  return (
    <FormSection title="تاریخچه">
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">رویدادی ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[40rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">زمان</th>
                <th className="px-3 py-2 font-medium">کاربر</th>
                <th className="px-3 py-2 font-medium">رویداد</th>
                <th className="px-3 py-2 font-medium">جزئیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatJalali(entry.createdAt)}{" "}
                    <span className="tabular-nums">{new Date(entry.createdAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.user?.username ?? "-"}</td>
                  <td className="px-3 py-2">{actionLabels[entry.action] ?? entry.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{entry.details || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}
