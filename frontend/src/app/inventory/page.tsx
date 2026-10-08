"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardPen, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, availableQuantity, formatQuantity, type InventoryLocation, type StockBalanceRow } from "./shared";

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
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // "قابل فروش" (available) is sortable in place of the deferred low-stock
  // report (Item has no reorder-level field yet) — clicking the column the
  // first time sorts ascending, so the lowest-stock items surface first.
  // The default stays the plain item-name sort the page always had.
  const [sortBy, setSortBy] = useState<"name" | "available">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const lastQueryRef = useRef(q);

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
        if (sortBy === "available") {
          params.set("sortBy", "available");
          params.set("sortDir", sortDir);
        }
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<StockBalanceRow>>(`/inventory/balances?${params.toString()}`);
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
  }, [q, locationId, page, sortBy, sortDir, reloadKey, canView]);

  function toggleAvailableSort() {
    setPage(1);
    if (sortBy !== "available") {
      setSortBy("available");
      setSortDir("asc");
    } else {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  const hasFilters = q !== "" || locationId !== "";

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
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => {
                  setQ("");
                  setLocationId("");
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
              {hasFilters ? "کالایی با این مشخصات در موجودی یافت نشد." : "هنوز موجودی‌ای ثبت نشده است. موجودی با ثبت نهایی «سند موجودی» وارد سیستم می‌شود."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              {error ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p> : null}
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">کد کالا</th>
                    <th className="px-3 py-2.5 font-medium">نام کالا</th>
                    <th className="px-3 py-2.5 font-medium">واحد</th>
                    <th className="px-3 py-2.5 font-medium">انبار</th>
                    <th className="px-3 py-2.5 font-medium">موجودی انبار</th>
                    <th className="px-3 py-2.5 font-medium">رزروشده</th>
                    <th className="px-3 py-2.5 font-medium">کنترل کیفیت</th>
                    <th className="px-3 py-2.5 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={toggleAvailableSort}
                        aria-label={`مرتب‌سازی بر اساس قابل فروش${sortBy === "available" ? (sortDir === "asc" ? " (صعودی)" : " (نزولی)") : ""}`}
                      >
                        قابل فروش
                        {sortBy === "available" ? (
                          sortDir === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const available = availableQuantity(row);
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
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
                        <td className={`px-3 py-2 font-medium tabular-nums ${available <= 0 ? "text-destructive" : ""}`}>{formatQuantity(available)}</td>
                      </tr>
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
