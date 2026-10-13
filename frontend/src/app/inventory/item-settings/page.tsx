"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeDigits } from "@/lib/number-input";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, type ItemOption } from "../shared";
import { FormSection } from "../adjustments/_form/FormSection";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

// GET/PUT /inventory/item-settings/:itemId (inventory.manage).
type ItemSetting = {
  item: { id: number; code: string; name: string };
  batchTracked: boolean;
  expiryRequired: boolean;
  shelfLifeDays: number | null;
  batchTrackedSince: string | null;
  updatedAt: string | null;
};

type FormState = { enableTracking: boolean; expiryRequired: boolean; shelfLifeDays: string };

function formFrom(setting: ItemSetting): FormState {
  return { enableTracking: false, expiryRequired: setting.expiryRequired, shelfLifeDays: setting.shelfLifeDays === null ? "" : String(setting.shelfLifeDays) };
}

// ?itemId= read once, client-only, without useSearchParams()'s Suspense
// requirement — same approach as sales-returns/SalesReturnRequestForm.tsx.
function subscribeToNothing() {
  return () => {};
}
function readLocationSearch() {
  return window.location.search;
}
function readServerLocationSearch() {
  return null;
}

// تنظیمات بچ و انقضا (I4): per-item batch/expiry configuration. Batch
// tracking is one-way: it can be switched on here only while the item has no
// stock anywhere (the backend refuses otherwise with 409 STOCK_NONZERO —
// an item WITH stock is converted via a «تبدیل به ردیابی بچ» adjustment), and
// it can never be switched off. «الزام تاریخ انقضا» / «طول عمر» are editable
// anytime. The backend is authoritative for every rule; this page only
// reflects them.
export default function ItemSettingsPage() {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canManage = user?.permissions.includes("inventory.manage") ?? false;

  const locationSearch = useSyncExternalStore(subscribeToNothing, readLocationSearch, readServerLocationSearch);
  const initialItemId = useMemo(() => {
    const raw = locationSearch === null ? null : new URLSearchParams(locationSearch).get("itemId");
    return raw && /^\d+$/.test(raw) ? raw : "";
  }, [locationSearch]);

  const [items, setItems] = useState<ItemOption[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [itemId, setItemId] = useState("");
  const [appliedInitial, setAppliedInitial] = useState(false);
  if (!appliedInitial && locationSearch !== null) {
    setAppliedInitial(true);
    if (initialItemId) setItemId(initialItemId);
  }

  const [setting, setSetting] = useState<ItemSetting | null>(null);
  const [settingLoading, setSettingLoading] = useState(false);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ enableTracking: false, expiryRequired: false, shelfLifeDays: "" });
  const [saving, setSaving] = useState(false);
  // 409 STOCK_NONZERO — kept inline (not just a toast) with the way forward.
  const [stockNonZero, setStockNonZero] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    apiFetch<ItemOption[]>("/inventory/item-options")
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setItemsError((reason as ApiError).message ?? "دریافت فهرست کالاها ناموفق بود.");
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  useEffect(() => {
    if (!canManage || !itemId) return;
    let cancelled = false;
    async function load() {
      setSettingLoading(true);
      setSettingError(null);
      setStockNonZero(null);
      try {
        const data = await apiFetch<ItemSetting>(`/inventory/item-settings/${itemId}`);
        if (cancelled) return;
        setSetting(data);
        setForm(formFrom(data));
      } catch (reason) {
        if (!cancelled) {
          setSetting(null);
          setSettingError((reason as ApiError).message ?? "دریافت تنظیمات کالا ناموفق بود.");
        }
      } finally {
        if (!cancelled) setSettingLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage, itemId, reloadKey]);

  const filteredItems = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term) || String(item.id) === itemId);
  }, [items, q, itemId]);

  function selectItem(next: string) {
    setItemId(next);
    if (!next) setSetting(null);
    router.replace(next ? `/inventory/item-settings?itemId=${next}` : "/inventory/item-settings", { scroll: false });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setting) return;
    const shelfLife = normalizeDigits(form.shelfLifeDays.trim());
    if (shelfLife !== "" && !/^[0-9]+$/.test(shelfLife)) {
      pushError("طول عمر باید عدد صحیح (روز) باشد.");
      return;
    }
    if (form.enableTracking && !window.confirm("ردیابی بچ برای این کالا فعال می‌شود و دیگر قابل غیرفعال‌سازی نیست. ادامه می‌دهید؟")) return;
    setSaving(true);
    setStockNonZero(null);
    try {
      const saved = await apiFetch<ItemSetting>(`/inventory/item-settings/${setting.item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expiryRequired: form.expiryRequired,
          shelfLifeDays: shelfLife === "" ? null : shelfLife,
          ...(form.enableTracking ? { batchTracked: true } : {}),
        }),
      });
      setSetting(saved);
      setForm(formFrom(saved));
      pushSuccess("تنظیمات بچ و انقضا ذخیره شد.");
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "STOCK_NONZERO") setStockNonZero(apiError.message);
      else if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره تنظیمات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <NoAccess message="اجازه مدیریت تنظیمات موجودی را ندارید." />;

  const dirty =
    setting !== null &&
    (form.enableTracking || form.expiryRequired !== setting.expiryRequired || form.shelfLifeDays.trim() !== (setting.shelfLifeDays === null ? "" : String(setting.shelfLifeDays)));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">تنظیمات بچ و انقضا</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ردیابی بچ (شماره سری ساخت) و تاریخ انقضا برای هر کالا. فعال‌سازی ردیابی بچ یک‌طرفه است و فقط برای کالای بدون موجودی از این صفحه ممکن است.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-56 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کالا</span>
                <input className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground" placeholder="نام یا کد کالا" value={q} onChange={(event) => setQ(event.target.value)} />
              </label>
            </div>
            <div className="flex min-w-72 flex-1 flex-col gap-1">
              <Label htmlFor="item-settings-item" className={toolbarFieldLabel}>کالا</Label>
              <select id="item-settings-item" className={`${selectClass} w-full`} value={itemId} disabled={itemsLoading} onChange={(event) => selectItem(event.target.value)}>
                <option value="">{itemsLoading ? "در حال بارگذاری کالاها..." : "انتخاب کالا"}</option>
                {/* A deep-linked item that isn't active/listed still shows as selected. */}
                {itemId && !items.some((item) => String(item.id) === itemId) && setting ? <option value={itemId}>{setting.item.name} ({setting.item.code})</option> : null}
                {filteredItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {itemsError ? <p className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{itemsError}</p> : null}
        </div>

        {!itemId ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">برای مشاهده و ویرایش تنظیمات، یک کالا انتخاب کنید.</p>
        ) : settingError && !setting ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm">
            <p className="text-destructive">{settingError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>تلاش دوباره</Button>
          </div>
        ) : settingLoading && !setting ? (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری تنظیمات...</p>
        ) : setting ? (
          <form id="item-settings-form" onSubmit={submit} noValidate className={`space-y-3 ${settingLoading ? "pointer-events-none opacity-60" : ""}`}>
            <FormSection title={`تنظیمات بچ و انقضا — ${setting.item.name}`}>
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-muted-foreground">ردیابی بچ:</span>
                  {setting.batchTracked ? <StatusBadge label="فعال" tone="success" /> : <StatusBadge label="غیرفعال" tone="muted" />}
                  {setting.batchTracked && setting.batchTrackedSince ? <span className="text-muted-foreground">از تاریخ {formatJalali(setting.batchTrackedSince)}</span> : null}
                  <span className="font-mono text-xs text-muted-foreground">{setting.item.code}</span>
                  <Link href={`/inventory/items/${setting.item.id}`} className="ms-auto text-xs text-primary hover:underline">کاردکس کالا ←</Link>
                </div>

                {setting.batchTracked ? (
                  <p className="text-xs text-muted-foreground">فعال — یک‌طرفه، قابل غیرفعال‌سازی نیست.</p>
                ) : (
                  <div className="space-y-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={form.enableTracking}
                        onChange={(event) => setForm((current) => ({ ...current, enableTracking: event.target.checked }))}
                      />
                      فعال‌سازی ردیابی بچ
                    </label>
                    <p className="text-xs text-muted-foreground">فقط برای کالای بدون موجودی؛ برای کالای دارای موجودی از سند «تبدیل به ردیابی بچ» استفاده کنید.</p>
                  </div>
                )}

                {stockNonZero ? (
                  <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-destructive">{stockNonZero}</p>
                    <Link href={`/inventory/adjustments/new?kind=BATCH_CUTOVER&itemId=${setting.item.id}`} className="text-xs text-primary hover:underline">
                      ایجاد سند «تبدیل به ردیابی بچ» برای این کالا ←
                    </Link>
                  </div>
                ) : null}

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={form.expiryRequired}
                    onChange={(event) => setForm((current) => ({ ...current, expiryRequired: event.target.checked }))}
                  />
                  الزام تاریخ انقضا
                  <span className="text-xs text-muted-foreground">(هر بچ جدید این کالا باید تاریخ انقضا داشته باشد)</span>
                </label>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-settings-shelf-life">طول عمر (روز)</Label>
                  <Input
                    id="item-settings-shelf-life"
                    dir="ltr"
                    inputMode="numeric"
                    className="w-40"
                    value={form.shelfLifeDays}
                    placeholder="اختیاری"
                    onChange={(event) => setForm((current) => ({ ...current, shelfLifeDays: event.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">اختیاری — اگر برای بچ جدید تاریخ انقضا وارد نشود ولی تاریخ تولید وارد شود، تاریخ انقضا از تاریخ تولید + این تعداد روز محاسبه می‌شود.</p>
                </div>

                {setting.updatedAt ? <p className="text-xs text-muted-foreground">آخرین تغییر: {formatJalali(setting.updatedAt)}</p> : null}
              </div>
            </FormSection>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? "در حال ذخیره..." : "ذخیره"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || !dirty}
                onClick={() => {
                  setForm(formFrom(setting));
                  setStockNonZero(null);
                }}
              >
                انصراف
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
