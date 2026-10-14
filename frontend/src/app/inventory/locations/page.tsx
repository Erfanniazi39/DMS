"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { fillSuggestedCode } from "@/lib/suggested-code";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess } from "../shared";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import { ListPagination } from "@/components/ui/list-pagination";
import type { SortValue } from "@/lib/table-sort";

// انبارها (I7's location-admin slice — transfers are explicitly out of
// scope for now). Plain master data: code/name/isActive/isDefault/note.
// GET /inventory/locations already returns every location (needs only
// inventory.view — it backs every location picker across the module);
// create/update are gated on inventory.manage, same as stock-levels/
// item-settings/integrity. There is no delete: a location already
// referenced by stock history is retired by deactivating it, same
// convention as Units/PurchaseType. isDefault is exclusive — the backend
// unsets the previous default atomically when a new one is set, and
// refuses to leave zero defaults (unsetting the current default directly,
// or deactivating it, is refused there; this page just surfaces that
// message, it doesn't re-derive the rule).
type Location = { id: number; code: string; name: string; isActive: boolean; isDefault: boolean; note: string | null };
type FormState = { code: string; name: string; isActive: boolean; isDefault: boolean; note: string };
type StatusFilter = "all" | "active" | "inactive";

const emptyForm: FormState = { code: "", name: "", isActive: true, isDefault: false, note: "" };

// Accessors for in-memory column sorting — each sorts by what its column shows.
const INVENTORY_LOCATIONS_SORT_GETTERS: Record<string, (row: Location) => SortValue> = {
  code: (row) => row.code,
  name: (row) => row.name,
  note: (row) => row.note,
  isDefault: (row) => row.isDefault,
  isActive: (row) => row.isActive ? "فعال" : "غیرفعال",
};

export default function InventoryLocationsPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canManage = user?.permissions.includes("inventory.manage") ?? false;

  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      setLocations(await apiFetch<Location[]>("/inventory/locations"));
    } catch (reason) {
      setLoadError((reason as ApiError).message ?? "دریافت فهرست انبارها ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    const run = async () => loadAll();
    void run();
    // Loaded once on mount; loadAll is re-invoked explicitly after any
    // create/edit instead of being tracked as a dependency here.
  }, [canView]);

  const filteredLocations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return locations.filter((location) => {
      const matchesQuery =
        normalizedQuery === "" || location.name.toLowerCase().includes(normalizedQuery) || location.code.toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? location.isActive : !location.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [locations, query, statusFilter]);
  // Sort + page the (small, already loaded) rows in memory; click a header to sort.
  const table = useClientTable(filteredLocations, INVENTORY_LOCATIONS_SORT_GETTERS, { pageSize: 20 });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    fillSuggestedCode("/inventory/locations/next-code", (code) => setForm((current) => (current.code === "" ? { ...current, code } : current)));
    setFormOpen(true);
  }

  function openEditForm(location: Location) {
    setEditingId(location.id);
    setForm({ code: location.code, name: location.name, isActive: location.isActive, isDefault: location.isDefault, note: location.note ?? "" });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      pushError("کد و نام انبار الزامی است.");
      return;
    }
    if (form.isDefault && !form.isActive) {
      pushError("انبار غیرفعال نمی‌تواند پیش‌فرض باشد.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        isActive: form.isActive,
        isDefault: form.isDefault,
        note: form.note.trim() === "" ? null : form.note.trim(),
      };
      await apiFetch(editingId ? `/inventory/locations/${editingId}` : "/inventory/locations", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingId ? "انبار با موفقیت ویرایش شد." : "انبار جدید با موفقیت ایجاد شد.");
      closeForm();
      await loadAll();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره انبار ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <NoAccess message="اجازه دسترسی به انبارها را ندارید." />;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">انبارها</h1>
            <p className="mt-1 text-sm text-muted-foreground">مدیریت انبارهای شرکت — هر سند موجودی (شمارش، رسید، اصلاح و...) در یکی از این انبارها ثبت می‌شود.</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن انبار
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3">
            <label className="flex h-8 w-56 items-center overflow-hidden rounded-md border border-input bg-background">
              <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">جستجوی انبار</span>
              <input
                className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                placeholder="نام یا کد انبار"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="location-status-filter" className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                وضعیت
              </Label>
              <select
                id="location-status-filter"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">همه</option>
                <option value="active">فعال</option>
                <option value="inactive">غیرفعال</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری انبارها...</p>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 p-10 text-center">
            <p className="text-sm text-destructive" role="alert">
              {loadError}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              تلاش مجدد
            </Button>
          </div>
        ) : filteredLocations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            {locations.length === 0 ? "هنوز انباری ثبت نشده است." : "انباری با این مشخصات یافت نشد."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[42rem] text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <SortHeader label="کد" sortKey="code" sort={table.sort} onSort={table.onSort} className="px-4 py-3 font-medium" />
                  <SortHeader label="نام" sortKey="name" sort={table.sort} onSort={table.onSort} className="px-4 py-3 font-medium" />
                  <SortHeader label="یادداشت" sortKey="note" sort={table.sort} onSort={table.onSort} className="px-4 py-3 font-medium" />
                  <SortHeader label="پیش‌فرض" sortKey="isDefault" sort={table.sort} onSort={table.onSort} className="px-4 py-3 font-medium" />
                  <SortHeader label="وضعیت" sortKey="isActive" sort={table.sort} onSort={table.onSort} className="px-4 py-3 font-medium" />
                  {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.pageRows.map((location) => (
                  <tr key={location.id} className={location.isActive ? "hover:bg-muted/30" : "text-muted-foreground hover:bg-muted/30"}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{location.code}</td>
                    <td className="px-4 py-3 font-medium">{location.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{location.note ?? "—"}</td>
                    <td className="px-4 py-3">{location.isDefault ? <StatusBadge label="پیش‌فرض" tone="primary" /> : null}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={location.isActive ? "فعال" : "غیرفعال"} tone={location.isActive ? "success" : "muted"} />
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        <Button variant="link" size="sm" onClick={() => openEditForm(location)}>
                          ویرایش
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
            {table.total > table.pageSize ? <ListPagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} className="mt-3" /> : null}
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "ویرایش انبار" : "افزودن انبار جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="location-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveLocation} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="location-code">کد</Label>
                <Input id="location-code" dir="ltr" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="location-name">نام</Label>
                <Input id="location-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="location-note">یادداشت</Label>
                <Input id="location-note" value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="اختیاری" />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label htmlFor="location-is-active" className="flex items-center gap-2 text-sm">
                  <input
                    id="location-is-active"
                    type="checkbox"
                    className="size-4"
                    checked={form.isActive}
                    onChange={(event) => {
                      const isActive = event.target.checked;
                      update("isActive", isActive);
                      if (!isActive) update("isDefault", false);
                    }}
                  />
                  فعال
                </label>
                <p className="text-xs text-muted-foreground">انبار غیرفعال در فهرست انتخاب انبار اسناد جدید نمایش داده نمی‌شود.</p>
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label htmlFor="location-is-default" className="flex items-center gap-2 text-sm">
                  <input
                    id="location-is-default"
                    type="checkbox"
                    className="size-4"
                    checked={form.isDefault}
                    disabled={!form.isActive}
                    onChange={(event) => update("isDefault", event.target.checked)}
                  />
                  انبار پیش‌فرض
                </label>
                <p className="text-xs text-muted-foreground">
                  انبار پیش‌فرض برای اسنادی استفاده می‌شود که انبار را صریحاً تعیین نکرده‌اند. فقط یک انبار می‌تواند پیش‌فرض باشد؛ علامت‌زدن این مورد، انبار پیش‌فرض قبلی را خودکار لغو می‌کند.
                </p>
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="location-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد انبار"}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
