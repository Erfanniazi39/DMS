"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ClipboardPen, Layers, ScrollText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, availableQuantity, batchHasStock, formatQuantity, type InventoryLocation, type ItemBatchRow, type ItemBatches, type StockBalanceRow } from "./shared";
import { BatchBreakdownTable } from "./_batches/BatchBreakdownTable";
import { SortHeader, useTableSort } from "@/components/ui/sortable";
import { sortQuery } from "@/lib/table-sort";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Stock list (لیست موجودی) — one row per item+warehouse that has ever had a
// stock movement. Balances come straight from the backend (StockBalance,
// written only by the stock ledger); "قابل فروش" is onHand − reserved,
// computed here for display only.
export default function InventoryPage() {
  const router = useRouter();
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canAdjust = user?.permissions.includes("inventory.adjust") ?? false;

  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [locationId, setLocationId] = useState("");
  // I3 (B14): only rows below their own configured threshold (set on
  // /inventory/stock-levels) — never a system-invented default.
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Every column sorts server-side; «قابل فروش» (available) is the computed
  // one — the first click sorts ascending, so the lowest-stock items surface
  // first. The default stays the plain item-name order the page always had.
  const { sort, onSort } = useTableSort(null, () => setPage(1));
  const lastQueryRef = useRef(q);
  // I4: per-row batch drill-down (keyed by balance row id), loaded on first expand.
  const [expanded, setExpanded] = useState<Record<number, ItemBatchRow[] | "loading" | "error">>({});

  function toggleBatches(row: StockBalanceRow) {
    if (expanded[row.id] !== undefined) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      return;
    }
    setExpanded((current) => ({ ...current, [row.id]: "loading" }));
    apiFetch<ItemBatches>(`/inventory/items/${row.itemId}/batches?locationId=${row.locationId}`)
      .then((data) => setExpanded((current) => (current[row.id] === undefined ? current : { ...current, [row.id]: data.batches })))
      .catch((reason: unknown) => {
        setExpanded((current) => (current[row.id] === undefined ? current : { ...current, [row.id]: "error" }));
        pushError((reason as ApiError).message ?? "دریافت بچ‌های کالا ناموفق بود.");
      });
  }

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
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (locationId) params.set("locationId", locationId);
        if (lowStockOnly) params.set("lowStockOnly", "true");
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<StockBalanceRow>>(`/inventory/balances?${params.toString()}${sortQuery(sort)}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError((reason as ApiError).message ?? "دریافت موجودی ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const queryChanged = q !== lastQueryRef.current;
    lastQueryRef.current = q;
    const timeout = setTimeout(() => void load(), queryChanged && q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [q, locationId, lowStockOnly, page, sort, reloadKey, canView]);

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  const hasFilters = q !== "" || locationId !== "" || lowStockOnly;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">موجودی کالا</h1>
            <p className="mt-1 text-sm text-muted-foreground">موجودی هر کالا در انبار، بر اساس اسناد ثبت‌شده</p>
          </div>
          {canAdjust ? (
            <Button onClick={() => router.push("/inventory/adjustments/new")}>
              <ClipboardPen className="size-4" aria-hidden="true" />
              سند موجودی جدید
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-60 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کالا</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="نام یا کد کالا"
                  value={q}
                  onChange={(event) => {
                    setQ(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </div>
            {/* Single warehouse today — the filter only appears once there's more than one. */}
            {locations.length > 1 ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-location" className={toolbarFieldLabel}>انبار</Label>
                <select
                  id="filter-location"
                  className={toolbarSelectClass}
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">همه</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>&nbsp;</span>
              <label className="flex h-8 items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={lowStockOnly}
                  onChange={(event) => {
                    setLowStockOnly(event.target.checked);
                    setPage(1);
                  }}
                />
                فقط کالاهای زیر آستانه (کمبود موجودی)
              </label>
            </div>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => {
                  setQ("");
                  setLocationId("");
                  setLowStockOnly(false);
                  setPage(1);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {error && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
              <p className="text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)}>
                تلاش دوباره
              </Button>
            </div>
          ) : loading && rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری موجودی...</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {lowStockOnly
                ? "کالایی زیر آستانه تعیین‌شده یافت نشد — یا هنوز آستانه‌ای در «آستانه‌های موجودی» تعیین نشده است."
                : hasFilters
                  ? "کالایی با این مشخصات در موجودی یافت نشد."
                  : "هنوز موجودی‌ای ثبت نشده است. موجودی با ثبت نهایی «سند موجودی» وارد سیستم می‌شود."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              {error ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p> : null}
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <SortHeader label="کد کالا" sortKey="code" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="نام کالا" sortKey="name" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="واحد" sortKey="unit" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="انبار" sortKey="location" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="موجودی انبار" sortKey="onHand" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="رزروشده" sortKey="reserved" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="کنترل کیفیت" sortKey="qc" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="قابل فروش" sortKey="available" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <th className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const available = availableQuantity(row);
                    const batchState = expanded[row.id];
                    return (
                      <Fragment key={row.id}>
                      <tr className="hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-xs">{row.item.code}</td>
                        <td className="px-3 py-2">
                          {row.item.name}
                          {row.item.status === "inactive" ? <span className="ms-2 text-xs text-muted-foreground">(غیرفعال)</span> : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.item.unit.nameFa}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                        <td className="px-3 py-2 font-medium tabular-nums">{formatQuantity(row.onHand)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.reserved)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.qc)}</td>
                        <td className={`px-3 py-2 font-medium tabular-nums ${available <= 0 ? "text-destructive" : ""}`}>
                          <span className="inline-flex items-center gap-1.5">
                            {formatQuantity(available)}
                            {row.overCommitted ? (
                              <span title="بیش‌تخصیص: موجودی رزروشده بیشتر از موجودی انبار است">
                                <StatusBadge label="بیش‌تخصیص" tone="destructive" />
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-muted-foreground"
                              aria-expanded={batchState !== undefined}
                              onClick={() => toggleBatches(row)}
                            >
                              <Layers className="size-3.5" aria-hidden="true" />
                              بچ‌ها
                              {batchState !== undefined ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronLeft className="size-3.5" aria-hidden="true" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-muted-foreground"
                              onClick={() => router.push(`/inventory/items/${row.itemId}`)}
                            >
                              <ScrollText className="size-3.5" aria-hidden="true" />
                              کاردکس
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {batchState !== undefined ? (
                        <tr className="bg-muted/20">
                          <td colSpan={9} className="px-3 py-2">
                            <BatchDrillDown state={batchState} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// The expanded sub-row: only batches that still hold stock at this row's
// warehouse; depleted ones are summarised in one line (the stock card lists
// them all).
function BatchDrillDown({ state }: { state: ItemBatchRow[] | "loading" | "error" }) {
  if (state === "loading") return <p className="py-2 text-xs text-muted-foreground">در حال بارگذاری بچ‌ها...</p>;
  if (state === "error") return <p className="py-2 text-xs text-destructive">دریافت بچ‌های این کالا ناموفق بود.</p>;
  const withStock = state.filter(batchHasStock);
  const depleted = state.length - withStock.length;
  if (withStock.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {state.length === 0 ? "این کالا در این انبار بچی ندارد (ردیابی بچ برای آن فعال نیست یا هنوز بچی ثبت نشده است)." : "هیچ بچی از این کالا در این انبار موجودی ندارد."}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <BatchBreakdownTable batches={withStock} compact />
      {depleted > 0 ? <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{depleted.toLocaleString("fa-IR")} بچ تمام‌شده نمایش داده نشده است — فهرست کامل در کاردکس کالا.</p> : null}
    </div>
  );
}
