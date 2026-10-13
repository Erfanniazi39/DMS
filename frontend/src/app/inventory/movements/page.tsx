"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  batchLabel,
  formatSignedQuantity,
  referenceHref,
  referenceLabel,
  stockBucketLabels,
  stockMovementTypeLabels,
  stockReferenceTypeLabels,
  STOCK_BUCKETS,
  STOCK_MOVEMENT_TYPES,
  STOCK_REFERENCE_TYPES,
  type InventoryLocation,
  type ItemBatches,
  type ItemOption,
  type StockBucket,
  type StockMovementRow,
  type StockMovementType,
  type StockReferenceType,
} from "../shared";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterState = {
  itemId: string;
  locationId: string;
  bucket: "" | StockBucket;
  movementType: "" | StockMovementType;
  referenceType: "" | StockReferenceType;
  dateFrom: string;
  dateTo: string;
};

const emptyFilters: FilterState = { itemId: "", locationId: "", bucket: "", movementType: "", referenceType: "", dateFrom: "", dateTo: "" };

// Movement browser (/inventory/movements): a filterable, read-only view over
// the stock ledger (build plan §9) — mirrors frontend/src/app/purchases'
// list conventions. Never writes anything; stock-ledger.ts applyMovements()
// remains the only writer.
export default function StockMovementsPage() {
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canViewItems = user?.permissions.includes("items.view") ?? false;
  const canAdjust = user?.permissions.includes("inventory.adjust") ?? false;

  const [rows, setRows] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  // I4: batchId → {number, expiry}, resolved per item from GET
  // /inventory/items/:itemId/batches for the tracked items on the current
  // page (the movement list itself only carries batchId). Grows as pages load.
  const [batchInfo, setBatchInfo] = useState<Map<number, { batchNumber: string; expiryDate: string | null }>>(new Map());
  const [batchItemsLoaded, setBatchItemsLoaded] = useState<Set<number>>(new Set());
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);

  useEffect(() => {
    if (!canView) return;
    apiFetch<InventoryLocation[]>("/inventory/locations")
      .then(setLocations)
      .catch((reason: unknown) => pushError((reason as ApiError).message ?? "دریافت فهرست انبارها ناموفق بود."));
  }, [canView, pushError]);

  // The item filter dropdown degrades gracefully depending on which of the
  // two read-only item lookups the current role holds (same consideration
  // as /inventory/item-options's own header comment: WAREHOUSE has
  // inventory.adjust but not items.view, while Sales roles are the reverse).
  // If neither is held the dropdown is simply omitted — item filtering by
  // id still works if the page is ever linked to with ?itemId=.
  useEffect(() => {
    if (!canView) return;
    if (canViewItems) {
      apiFetch<{ id: number; code: string; name: string; unit: { id: number; nameFa: string } }[]>("/items")
        .then((data) => setItemOptions(data))
        .catch(() => undefined);
    } else if (canAdjust) {
      apiFetch<ItemOption[]>("/inventory/item-options")
        .then(setItemOptions)
        .catch(() => undefined);
    }
  }, [canView, canViewItems, canAdjust]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.itemId) params.set("itemId", filters.itemId);
        if (filters.locationId) params.set("locationId", filters.locationId);
        if (filters.bucket) params.set("bucket", filters.bucket);
        if (filters.movementType) params.set("movementType", filters.movementType);
        if (filters.referenceType) params.set("referenceType", filters.referenceType);
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<StockMovementRow>>(`/inventory/movements?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت دفتر گردش کالا ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, filters, page, reloadKey]);

  const missingBatchItemsKey = useMemo(
    () => [...new Set(rows.filter((row) => row.batchId !== null && !batchItemsLoaded.has(row.itemId)).map((row) => row.itemId))].join(","),
    [rows, batchItemsLoaded],
  );
  useEffect(() => {
    if (!missingBatchItemsKey) return;
    const itemIds = missingBatchItemsKey.split(",").map(Number);
    let cancelled = false;
    Promise.all(itemIds.map((id) => apiFetch<ItemBatches>(`/inventory/items/${id}/batches`).catch(() => null))).then((results) => {
      if (cancelled) return;
      setBatchInfo((current) => {
        const next = new Map(current);
        for (const result of results) for (const batch of result?.batches ?? []) next.set(batch.batchId, { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate });
        return next;
      });
      // Marked loaded even on failure — the column falls back to «بچ #id» rather than retrying forever.
      setBatchItemsLoaded((current) => new Set([...current, ...itemIds]));
    });
    return () => {
      cancelled = true;
    };
  }, [missingBatchItemsKey]);
  const batchNumberById = useMemo(() => new Map([...batchInfo].map(([id, info]) => [id, info.batchNumber])), [batchInfo]);
  const hasBatchRows = rows.some((row) => row.batchId !== null);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setPage(1);
  }

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">دفتر گردش کالا</h1>
          <p className="mt-1 text-sm text-muted-foreground">فهرست رویدادهای ثبت‌شده در دفتر موجودی، قابل فیلتر</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            {itemOptions.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-item" className={toolbarFieldLabel}>کالا</Label>
                <select id="filter-item" className={toolbarSelectClass} value={filters.itemId} onChange={(event) => updateFilter("itemId", event.target.value)}>
                  <option value="">همه</option>
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {locations.length > 1 ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-location" className={toolbarFieldLabel}>انبار</Label>
                <select id="filter-location" className={toolbarSelectClass} value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}>
                  <option value="">همه</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-bucket" className={toolbarFieldLabel}>نوع موجودی</Label>
              <select id="filter-bucket" className={toolbarSelectClass} value={filters.bucket} onChange={(event) => updateFilter("bucket", event.target.value as FilterState["bucket"])}>
                <option value="">همه</option>
                {STOCK_BUCKETS.map((bucket) => (
                  <option key={bucket} value={bucket}>{stockBucketLabels[bucket]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-movement-type" className={toolbarFieldLabel}>نوع رویداد</Label>
              <select
                id="filter-movement-type"
                className={toolbarSelectClass}
                value={filters.movementType}
                onChange={(event) => updateFilter("movementType", event.target.value as FilterState["movementType"])}
              >
                <option value="">همه</option>
                {STOCK_MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>{stockMovementTypeLabels[type]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-reference-type" className={toolbarFieldLabel}>نوع سند مرجع</Label>
              <select
                id="filter-reference-type"
                className={toolbarSelectClass}
                value={filters.referenceType}
                onChange={(event) => updateFilter("referenceType", event.target.value as FilterState["referenceType"])}
              >
                <option value="">همه</option>
                {STOCK_REFERENCE_TYPES.map((type) => (
                  <option key={type} value={type}>{stockReferenceTypeLabels[type]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>از تاریخ</span>
              <JalaliDateInput idPrefix="filter-date-from" value={filters.dateFrom} onChange={(value) => updateFilter("dateFrom", value)} />
            </div>
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>تا تاریخ</span>
              <JalaliDateInput idPrefix="filter-date-to" value={filters.dateTo} onChange={(value) => updateFilter("dateTo", value)} />
            </div>

            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {loadError && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
              <p className="text-destructive">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)}>
                تلاش دوباره
              </Button>
            </div>
          ) : loading && rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {hasActiveFilters ? "رویدادی با این مشخصات یافت نشد." : "هنوز رویدادی در دفتر موجودی ثبت نشده است."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              {loadError ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{loadError}</p> : null}
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">تاریخ</th>
                    <th className="px-3 py-2.5 font-medium">کالا</th>
                    <th className="px-3 py-2.5 font-medium">انبار</th>
                    <th className="px-3 py-2.5 font-medium">نوع موجودی</th>
                    <th className="px-3 py-2.5 font-medium">نوع رویداد</th>
                    <th className="px-3 py-2.5 font-medium">مقدار</th>
                    {hasBatchRows ? <th className="px-3 py-2.5 font-medium">بچ</th> : null}
                    <th className="px-3 py-2.5 font-medium">سند مرجع</th>
                    <th className="px-3 py-2.5 font-medium">کاربر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const quantity = Number(row.quantity);
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(row.movementDate)}</td>
                        <td className="px-3 py-2">
                          <Link href={`/inventory/items/${row.itemId}`} className="hover:underline">
                            {row.item.name}
                          </Link>
                          <span className="ms-1 font-mono text-xs text-muted-foreground">({row.item.code})</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{stockBucketLabels[row.bucket]}</td>
                        <td className="px-3 py-2">{stockMovementTypeLabels[row.movementType]}</td>
                        <td className={`px-3 py-2 font-medium tabular-nums ${quantity < 0 ? "text-destructive" : ""}`} dir="ltr">
                          {formatSignedQuantity(quantity)}
                        </td>
                        {hasBatchRows ? (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.batchId === null ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <span className="inline-flex flex-col">
                                <span className="font-mono text-xs">{batchLabel(row.batchId, batchNumberById)}</span>
                                {batchInfo.get(row.batchId)?.expiryDate ? (
                                  <span className="text-[11px] text-muted-foreground">انقضا {formatJalali(batchInfo.get(row.batchId)!.expiryDate)}</span>
                                ) : null}
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <Link href={referenceHref(row.referenceType, row.referenceId)} className="text-primary hover:underline">
                            {referenceLabel(row)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.createdByUser?.username ?? "-"}</td>
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
