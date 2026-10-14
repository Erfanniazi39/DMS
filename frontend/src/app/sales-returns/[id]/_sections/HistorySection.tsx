"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import type { SalesReturnHistoryEntry } from "../../shared";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import { ListPagination } from "@/components/ui/list-pagination";
import type { SortValue } from "@/lib/table-sort";

// «تاریخچه» — GET /sales-returns/:id/history (sales.view). Action codes
// from backend sales-returns.service.ts.
const actionLabels: Record<string, string> = {
  SALES_RETURN_REQUESTED: "ثبت درخواست",
  SALES_RETURN_APPROVED: "تأیید و صدور شماره",
  SALES_RETURN_REJECTED: "رد درخواست",
  SALES_RETURN_CANCELLED: "لغو",
  SALES_RETURN_RECEIVED: "دریافت کالا",
  SALES_RETURN_INSPECTED: "بازرسی و تعیین تکلیف",
  SALES_RETURN_COMPLETED_NO_CREDIT: "تکمیل بدون یادداشت اعتباری",
  SALES_RETURN_CREDITED: "صدور یادداشت اعتباری",
};

// Accessors for in-memory column sorting — each sorts by what its column shows.
const SALES_RETURNS_ID__SECTIONS_HISTORYSECTION_TSX_SORT_GETTERS: Record<string, (row: SalesReturnHistoryEntry) => SortValue> = {
  createdAt: (row) => row.createdAt,
  user: (row) => row.user?.username ?? null,
  action: (row) => actionLabels[row.action] ?? row.action,
};

export function HistorySection({ salesReturnId, reloadKey }: { salesReturnId: number; reloadKey: number }) {
  const [entries, setEntries] = useState<SalesReturnHistoryEntry[]>([]);
  // Sort + page the (small, already loaded) rows in memory; click a header to sort.
  const table = useClientTable(entries, SALES_RETURNS_ID__SECTIONS_HISTORYSECTION_TSX_SORT_GETTERS, { pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesReturnHistoryEntry[]>(`/sales-returns/${salesReturnId}/history`)
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
  }, [salesReturnId, reloadKey, retryKey]);

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
                <SortHeader label="زمان" sortKey="createdAt" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                <SortHeader label="کاربر" sortKey="user" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                <SortHeader label="رویداد" sortKey="action" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                <th className="px-3 py-2 font-medium">جزئیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.pageRows.map((entry) => (
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
          {table.total > table.pageSize ? <ListPagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} className="mt-3" /> : null}
    </FormSection>
  );
}
