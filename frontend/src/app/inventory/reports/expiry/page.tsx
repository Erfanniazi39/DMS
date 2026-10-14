"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, formatQuantity, type ExpiryReportRow, type InventoryLocation } from "../../shared";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import { ListPagination } from "@/components/ui/list-pagination";
import type { SortValue } from "@/lib/table-sort";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Look-ahead choices for withinDays — a display filter only, not a business
// threshold ("" = every dated batch with stock, however far out).
const WITHIN_DAYS_OPTIONS = ["30", "60", "90", "180", "365", ""] as const;

// Accessors for in-memory column sorting — each sorts by what its column shows.
const INVENTORY_REPORTS_EXPIRY_SORT_GETTERS: Record<string, (row: ExpiryReportRow) => SortValue> = {
  code: (row) => row.item?.code ?? null,
  name: (row) => row.item?.name ?? null,
  unit: (row) => row.item?.unit.nameFa ?? null,
  batchNumber: (row) => row.batchNumber,
  productionDate: (row) => row.productionDate,
  expiryDate: (row) => row.expiryDate,
  daysUntilExpiry: (row) => row.daysUntilExpiry,
  onHand: (row) => Number(row.onHand),
  qc: (row) => Number(row.qc),
};

// Stable empty list while the report is still loading.
const NO_ROWS: ExpiryReportRow[] = [];

// گزارش انقضای بچ‌ها (I4): every dated batch that still holds stock (ON_HAND
// or QC), soonest expiry first, straight from GET /inventory/reports/expiry —
// the backend decides what counts as expired (expiry date before today,
// Tehran calendar day; still deliverable on the expiry day itself) and the
// day count. Read-only, inventory.view — same layout as the low-stock report.
// Expired batches are excluded from "available" stock everywhere (B21) and
// must be written off with a «ضایعات» document.
export default function ExpiryReportPage() {
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;

  const [rows, setRows] = useState<ExpiryReportRow[] | null>(null);
  // Sort + page the (small, already loaded) rows in memory; click a header to sort.
  const table = useClientTable(rows ?? NO_ROWS, INVENTORY_REPORTS_EXPIRY_SORT_GETTERS, { pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [withinDays, setWithinDays] = useState<(typeof WITHIN_DAYS_OPTIONS)[number]>("90");
  const [includeExpired, setIncludeExpired] = useState(true);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  useEffect(() => {
    if (!canView) return;
    apiFetch<InventoryLocation[]>("/inventory/locations")
      .then(setLocations)
      .catch((reason: unknown) => pushError((reason as ApiError).message ?? "دریافت فهرست انبارها ناموفق بود."));
  }, [canView, pushError]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (withinDays) params.set("withinDays", withinDays);
        params.set("includeExpired", includeExpired ? "true" : "false");
        const data = await apiFetch<ExpiryReportRow[]>(`/inventory/reports/expiry?${params.toString()}`);
        if (!cancelled) setRows(data);
      } catch (reason) {
        if (!cancelled) {
          setRows(null);
          setError((reason as ApiError).message ?? "دریافت گزارش انقضا ناموفق بود.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, withinDays, includeExpired, reloadKey]);

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  const locationNames = new Map(locations.map((location) => [location.id, location.name]));
  const expiredCount = rows?.filter((row) => row.isExpired).length ?? 0;
  const upcomingCount = (rows?.length ?? 0) - expiredCount;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">گزارش انقضای بچ‌ها</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              بچ‌های دارای موجودی که تاریخ انقضای آن‌ها نزدیک است یا گذشته است، به ترتیب نزدیک‌ترین انقضا. موجودی بچ منقضی‌شده جزو «قابل فروش» حساب نمی‌شود
              و باید با سند «ضایعات» از موجودی کسر شود.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            به‌روزرسانی
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="expiry-within-days" className={toolbarFieldLabel}>انقضا تا</Label>
              <select
                id="expiry-within-days"
                className={toolbarSelectClass}
                value={withinDays}
                onChange={(event) => setWithinDays(event.target.value as (typeof WITHIN_DAYS_OPTIONS)[number])}
              >
                {WITHIN_DAYS_OPTIONS.map((days) => (
                  <option key={days || "all"} value={days}>
                    {days ? `${Number(days).toLocaleString("fa-IR")} روز آینده` : "همهٔ بچ‌های تاریخ‌دار"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>&nbsp;</span>
              <label className="flex h-8 items-center gap-1.5 text-xs">
                <input type="checkbox" className="size-3.5 rounded border-input" checked={includeExpired} onChange={(event) => setIncludeExpired(event.target.checked)} />
                نمایش بچ‌های منقضی‌شده
              </label>
            </div>
            {rows && rows.length > 0 ? (
              <p className="ms-auto self-center text-xs text-muted-foreground">
                {includeExpired ? (
                  <>
                    منقضی‌شده: <span className="font-medium text-destructive tabular-nums">{expiredCount.toLocaleString("fa-IR")}</span>
                    {" — "}
                  </>
                ) : null}
                رو به انقضا: <span className="font-medium text-foreground tabular-nums">{upcomingCount.toLocaleString("fa-IR")}</span>
              </p>
            ) : null}
          </div>

          {error ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
              <p className="text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>تلاش دوباره</Button>
            </div>
          ) : loading && !rows ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری گزارش...</p>
          ) : !rows || rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              بچ دارای موجودی با تاریخ انقضا در این بازه یافت نشد — یا هنوز هیچ کالایی ردیابی بچ ندارد.
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <SortHeader label="کد کالا" sortKey="code" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="نام کالا" sortKey="name" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="واحد" sortKey="unit" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    {locations.length > 1 ? <th className="px-3 py-2.5 font-medium">انبار</th> : null}
                    <SortHeader label="شماره بچ" sortKey="batchNumber" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="تاریخ تولید" sortKey="productionDate" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="تاریخ انقضا" sortKey="expiryDate" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="مانده تا انقضا" sortKey="daysUntilExpiry" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="موجودی انبار" sortKey="onHand" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="کنترل کیفیت" sortKey="qc" sort={table.sort} onSort={table.onSort} className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {table.pageRows.map((row) => (
                    <tr key={`${row.batchId}:${row.locationId}`} className={row.isExpired ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40"}>
                      <td className="px-3 py-2 font-mono text-xs">{row.item?.code ?? "-"}</td>
                      <td className="px-3 py-2">
                        <Link href={`/inventory/items/${row.itemId}`} className="hover:underline">
                          {row.item?.name ?? `کالا #${row.itemId.toLocaleString("fa-IR")}`}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.item?.unit.nameFa ?? "-"}</td>
                      {locations.length > 1 ? <td className="px-3 py-2 text-muted-foreground">{locationNames.get(row.locationId) ?? "-"}</td> : null}
                      <td className="px-3 py-2 font-mono text-xs">{row.batchNumber}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.productionDate ? formatJalali(row.productionDate) : "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatJalali(row.expiryDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.isExpired ? (
                          <span className="inline-flex items-center gap-1.5 text-destructive">
                            <TriangleAlert className="size-3.5" aria-hidden="true" />
                            <StatusBadge label="منقضی‌شده" tone="destructive" />
                            <span className="text-xs tabular-nums">{Math.abs(row.daysUntilExpiry).toLocaleString("fa-IR")} روز گذشته</span>
                          </span>
                        ) : row.daysUntilExpiry === 0 ? (
                          <StatusBadge label="امروز آخرین روز" tone="warning" />
                        ) : (
                          <span className="tabular-nums">{row.daysUntilExpiry.toLocaleString("fa-IR")} روز</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium tabular-nums">{formatQuantity(row.onHand)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.qc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
              {table.total > table.pageSize ? <ListPagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} className="mt-3" /> : null}
        </div>
      </div>
    </div>
  );
}
