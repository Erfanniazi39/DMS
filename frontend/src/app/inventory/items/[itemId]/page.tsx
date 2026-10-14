"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { useFeature } from "@/lib/session";
import {
  NoAccess,
  batchHasStock,
  batchLabel,
  formatQuantity,
  formatSignedQuantity,
  referenceHref,
  referenceLabel,
  stockBucketLabels,
  stockMovementTypeLabels,
  type InventoryLocation,
  type ItemBatches,
  type StockCard,
} from "../../shared";
import { BatchBreakdownTable } from "../../_batches/BatchBreakdownTable";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Stock card (کاردکس): every StockMovement for one item, across locations,
// in posting order, with a running balance per bucket (build plan §9). A
// mirror of /inventory/adjustments/[id]'s detail-page conventions but for a
// read-only, backend-computed ledger view — never writes anything.
export default function StockCardPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = Number(params.itemId);
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canManage = user?.permissions.includes("inventory.manage") ?? false;
  const batchTrackingOn = useFeature("inventoryBatchTracking");

  const [card, setCard] = useState<StockCard | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // I4: the item's batches (null = not loaded / failed — the section just
  // hides; the ledger itself never depends on it).
  const [batches, setBatches] = useState<ItemBatches["batches"] | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [showDepleted, setShowDepleted] = useState(false);

  useEffect(() => {
    if (!canView) return;
    apiFetch<InventoryLocation[]>("/inventory/locations")
      .then(setLocations)
      .catch((reason: unknown) => pushError((reason as ApiError).message ?? "دریافت فهرست انبارها ناموفق بود."));
  }, [canView, pushError]);

  useEffect(() => {
    if (!canView || !Number.isInteger(itemId) || itemId < 1) return;
    let cancelled = false;
    function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (locationId) params.set("locationId", locationId);
      apiFetch<ItemBatches>(`/inventory/items/${itemId}/batches?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setBatches(data.batches);
          setBatchesError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setBatches(null);
          setBatchesError((reason as ApiError).message ?? "دریافت بچ‌های کالا ناموفق بود.");
        });
      apiFetch<StockCard>(`/inventory/items/${itemId}/stock-card?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setCard(data);
          setLoadError(null);
        })
        .catch((reason: unknown) => {
          if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت کاردکس کالا ناموفق بود.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    // Deferred (not called synchronously in the effect body) — same
    // convention as /inventory/page.tsx, which sidesteps the
    // react-hooks/set-state-in-effect rule the same way.
    const timeout = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [canView, itemId, locationId]);

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  if (loading && !card) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری کاردکس کالا...</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "کالا یافت نشد."}</p>
          <Link href="/inventory" className="text-primary hover:underline">بازگشت به موجودی ←</Link>
        </div>
      </div>
    );
  }

  const last = card.rows.at(-1)?.balanceAfter;
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));
  // Every batch that ever held stock has a balance row, so this resolves the
  // batch number of every ledger row (depleted batches included).
  const batchById = new Map((batches ?? []).map((batch) => [batch.batchId, batch]));
  const batchNumberById = new Map((batches ?? []).map((batch) => [batch.batchId, batch.batchNumber]));
  const hasBatchRows = card.rows.some((row) => row.batchId !== null);
  const visibleBatches = (batches ?? []).filter((batch) => showDepleted || batchHasStock(batch));
  const depletedCount = (batches ?? []).length - (batches ?? []).filter(batchHasStock).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">کاردکس کالا — {card.item.name}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{card.item.code}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {canManage && batchTrackingOn ? (
              <Link href={`/inventory/item-settings?itemId=${card.item.id}`} className="text-sm text-primary hover:underline">
                تنظیمات بچ و انقضا
              </Link>
            ) : null}
            <Link href="/inventory" className="text-sm text-primary hover:underline">بازگشت به موجودی ←</Link>
          </div>
        </div>

        {loadError ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{loadError}</p> : null}

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">موجودی انبار فعلی</p>
            <p className="mt-1 font-medium tabular-nums">{formatQuantity(last?.onHand ?? "0")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">رزروشده فعلی</p>
            <p className="mt-1 font-medium tabular-nums">{formatQuantity(last?.reserved ?? "0")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">کنترل کیفیت فعلی</p>
            <p className="mt-1 font-medium tabular-nums">{formatQuantity(last?.qc ?? "0")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">واحد</p>
            <p className="mt-1 font-medium">{card.item.unit.nameFa}</p>
          </div>
        </div>

        {batchesError ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{batchesError}</p> : null}
        {batches && batches.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold">بچ‌های کالا</h2>
              {depletedCount > 0 ? (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" className="size-3.5 rounded border-input" checked={showDepleted} onChange={(event) => setShowDepleted(event.target.checked)} />
                  نمایش بچ‌های تمام‌شده ({depletedCount.toLocaleString("fa-IR")})
                </label>
              ) : null}
            </div>
            {visibleBatches.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">هیچ بچی از این کالا موجودی ندارد.</p>
            ) : (
              <div className="overflow-x-auto">
                <BatchBreakdownTable batches={visibleBatches} locationNames={locationNames} />
              </div>
            )}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {locations.length > 1 ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="stock-card-location" className={toolbarFieldLabel}>انبار</Label>
                <select id="stock-card-location" className={toolbarSelectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                  <option value="">همه انبارها</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {card.rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">هنوز رویدادی برای این کالا ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">تاریخ</th>
                    <th className="px-3 py-2.5 font-medium">نوع رویداد</th>
                    <th className="px-3 py-2.5 font-medium">انبار</th>
                    <th className="px-3 py-2.5 font-medium">نوع موجودی</th>
                    <th className="px-3 py-2.5 font-medium">مقدار</th>
                    {hasBatchRows ? <th className="px-3 py-2.5 font-medium">بچ</th> : null}
                    <th className="px-3 py-2.5 font-medium">موجودی انبار پس از رویداد</th>
                    <th className="px-3 py-2.5 font-medium">رزروشده پس از رویداد</th>
                    <th className="px-3 py-2.5 font-medium">سند مرجع</th>
                    <th className="px-3 py-2.5 font-medium">کاربر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...card.rows].reverse().map((row) => {
                    const quantity = Number(row.quantity);
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(row.movementDate)}</td>
                        <td className="px-3 py-2">{stockMovementTypeLabels[row.movementType]}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{stockBucketLabels[row.bucket]}</td>
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
                                {batchById.get(row.batchId)?.expiryDate ? (
                                  <span className="text-[11px] text-muted-foreground">انقضا {formatJalali(batchById.get(row.batchId)!.expiryDate)}</span>
                                ) : null}
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.balanceAfter.onHand)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.balanceAfter.reserved)}</td>
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
        </div>
      </div>
    </div>
  );
}
