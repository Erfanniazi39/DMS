"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, type InventoryLocation, type ItemOption, type ItemStockLevelRow } from "../shared";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

// Per-row editable state — strings (same convention as AdjustmentLinesGrid),
// parsed/validated by the backend at save time; this page's own checks are
// UX convenience only (B14's two rules are authoritative on the server).
type RowState = { minQty: string; reorderQty: string; maxQty: string; note: string };

function rowFromLevel(level: ItemStockLevelRow | undefined): RowState {
  return {
    minQty: level?.minQty ?? "",
    reorderQty: level?.reorderQty ?? "",
    maxQty: level?.maxQty ?? "",
    note: level?.note ?? "",
  };
}

function sameRow(a: RowState, b: RowState) {
  return a.minQty === b.minQty && a.reorderQty === b.reorderQty && a.maxQty === b.maxQty && a.note === b.note;
}

// آستانه‌های موجودی (I3, B14): min/reorder/max per item × location, entered
// by the user — nothing here is ever defaulted or invented by the system.
// A grid editor, one row per active item: minQty blank means "no threshold
// set yet" (never flagged as low); saving a row upserts it, clearing minQty
// on a row that already has a saved threshold and saving deletes it.
export default function StockLevelsPage() {
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canManage = user?.permissions.includes("inventory.manage") ?? false;

  const [items, setItems] = useState<ItemOption[]>([]);
  const [levels, setLevels] = useState<ItemStockLevelRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [itemOptions, locationList] = await Promise.all([
          apiFetch<ItemOption[]>("/inventory/item-options"),
          apiFetch<InventoryLocation[]>("/inventory/locations"),
        ]);
        if (cancelled) return;
        setItems(itemOptions);
        setLocations(locationList);
        const defaultLocation = locationList.find((location) => location.isDefault) ?? locationList[0] ?? null;
        setLocationId((current) => current ?? defaultLocation?.id ?? null);
      } catch (reason) {
        if (!cancelled) setError((reason as ApiError).message ?? "دریافت اطلاعات ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  useEffect(() => {
    if (!canManage || locationId === null) return;
    let cancelled = false;
    async function loadLevels() {
      try {
        const data = await apiFetch<ItemStockLevelRow[]>(`/inventory/stock-levels?locationId=${locationId}`);
        if (cancelled) return;
        setLevels(data);
        const byItem = new Map(data.map((level) => [level.itemId, level]));
        setRows(Object.fromEntries(items.map((item) => [item.id, rowFromLevel(byItem.get(item.id))])));
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت آستانه‌های موجودی ناموفق بود.");
      }
    }
    void loadLevels();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, locationId, items, reloadKey]);

  const levelByItem = useMemo(() => new Map(levels.map((level) => [level.itemId, level])), [levels]);

  const filteredItems = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term));
  }, [items, q]);

  function updateRow(itemId: number, patch: Partial<RowState>) {
    setRows((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? rowFromLevel(undefined)), ...patch } }));
  }

  async function saveRow(itemId: number) {
    if (locationId === null) return;
    const row = rows[itemId] ?? rowFromLevel(undefined);
    const existing = levelByItem.get(itemId);

    // Clearing minQty on a row that already has a saved threshold removes
    // it entirely (back to "no threshold set") — never sends an empty
    // minQty to the upsert endpoint, which requires one.
    if (row.minQty.trim() === "") {
      if (!existing) return;
      setSavingItemId(itemId);
      try {
        await apiFetch(`/inventory/stock-levels/${existing.id}`, { method: "DELETE" });
        pushSuccess("آستانه موجودی حذف شد.");
        setReloadKey((key) => key + 1);
      } catch (reason) {
        pushError((reason as ApiError).message ?? "حذف آستانه موجودی ناموفق بود.");
      } finally {
        setSavingItemId(null);
      }
      return;
    }

    setSavingItemId(itemId);
    try {
      await apiFetch("/inventory/stock-levels", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          locationId,
          minQty: row.minQty,
          reorderQty: row.reorderQty.trim() === "" ? undefined : row.reorderQty,
          maxQty: row.maxQty.trim() === "" ? undefined : row.maxQty,
          note: row.note.trim() === "" ? undefined : row.note,
        }),
      });
      pushSuccess("آستانه موجودی ذخیره شد.");
      setReloadKey((key) => key + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "ذخیره آستانه موجودی ناموفق بود.");
    } finally {
      setSavingItemId(null);
    }
  }

  async function removeRow(itemId: number) {
    const existing = levelByItem.get(itemId);
    if (!existing) return;
    setSavingItemId(itemId);
    try {
      await apiFetch(`/inventory/stock-levels/${existing.id}`, { method: "DELETE" });
      pushSuccess("آستانه موجودی حذف شد.");
      setReloadKey((key) => key + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف آستانه موجودی ناموفق بود.");
    } finally {
      setSavingItemId(null);
    }
  }

  if (!canManage) return <NoAccess message="اجازه مدیریت تنظیمات موجودی را ندارید." />;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">آستانه‌های موجودی</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            حداقل، مقدار سفارش مجدد و حداکثر موجودی هر کالا را خودتان تعیین می‌کنید — سیستم هیچ آستانه‌ای را خودکار تعیین نمی‌کند.
            هشدار کمبود موجودی بر اساس «موجودی قابل فروش» (موجودی انبار منهای رزروشده) محاسبه می‌شود.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-64 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کالا</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="نام یا کد کالا"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
              </label>
            </div>
            {locations.length > 1 ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="stock-level-location" className={toolbarFieldLabel}>انبار</Label>
                <select
                  id="stock-level-location"
                  className={selectClass}
                  value={locationId ?? ""}
                  onChange={(event) => setLocationId(Number(event.target.value))}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {q ? (
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setQ("")}>
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
              <p className="text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>تلاش دوباره</Button>
            </div>
          ) : loading ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری کالاها...</p>
          ) : filteredItems.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {q ? "کالایی با این مشخصات یافت نشد." : "کالای فعالی برای تعیین آستانه وجود ندارد."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">کد کالا</th>
                    <th className="px-3 py-2.5 font-medium">نام کالا</th>
                    <th className="px-3 py-2.5 font-medium">واحد</th>
                    <th className="w-28 px-3 py-2.5 font-medium">حداقل موجودی</th>
                    <th className="w-32 px-3 py-2.5 font-medium">مقدار سفارش مجدد</th>
                    <th className="w-28 px-3 py-2.5 font-medium">حداکثر موجودی</th>
                    <th className="w-48 px-3 py-2.5 font-medium">یادداشت</th>
                    <th className="w-24 px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredItems.map((item) => {
                    const row = rows[item.id] ?? rowFromLevel(undefined);
                    const existing = levelByItem.get(item.id);
                    const saved = rowFromLevel(existing);
                    const dirty = !sameRow(row, saved);
                    const saving = savingItemId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-xs">{item.code}</td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.unit.nameFa}</td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`حداقل موجودی ${item.name}`}
                            dir="ltr"
                            inputMode="decimal"
                            value={row.minQty}
                            placeholder="بدون آستانه"
                            onChange={(event) => updateRow(item.id, { minQty: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`مقدار سفارش مجدد ${item.name}`}
                            dir="ltr"
                            inputMode="decimal"
                            value={row.reorderQty}
                            onChange={(event) => updateRow(item.id, { reorderQty: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`حداکثر موجودی ${item.name}`}
                            dir="ltr"
                            inputMode="decimal"
                            value={row.maxQty}
                            onChange={(event) => updateRow(item.id, { maxQty: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`یادداشت ${item.name}`}
                            value={row.note}
                            onChange={(event) => updateRow(item.id, { note: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant={dirty ? "default" : "outline"}
                              size="icon-sm"
                              aria-label={`ذخیره ${item.name}`}
                              disabled={saving || !dirty}
                              onClick={() => void saveRow(item.id)}
                            >
                              <Save className="size-3.5" aria-hidden="true" />
                            </Button>
                            {existing ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label={`حذف آستانه ${item.name}`}
                                disabled={saving}
                                onClick={() => void removeRow(item.id)}
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
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
