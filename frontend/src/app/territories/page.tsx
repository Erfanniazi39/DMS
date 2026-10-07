"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";

// Sales territories — optional classification on a customer (dropdown
// reads the active-only GET /territories). This page reads
// GET /territories/all (customers.view) and writes via POST/PATCH
// /territories (customers.manage). A straight copy of the Item Categories
// page. No delete: retire a territory by deactivating it.
type Territory = { id: number; code: string; nameEn: string; nameFa: string; isActive: boolean; sortOrder: number };
type FormState = { code: string; nameEn: string; nameFa: string; isActive: boolean; sortOrder: string };
type StatusFilter = "all" | "active" | "inactive";

const emptyForm: FormState = { code: "", nameEn: "", nameFa: "", isActive: true, sortOrder: "" };

export default function TerritoryPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("customers.view") ?? false;
  // Write actions (create/edit) are hidden without customers.manage — the
  // backend would reject them anyway, this just avoids offering them.
  const canManage = user?.permissions.includes("customers.manage") ?? false;

  const [rows, setRows] = useState<Territory[]>([]);
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
      setRows(await apiFetch<Territory[]>("/territories/all"));
    } catch (reason) {
      setLoadError((reason as ApiError).message ?? "دریافت فهرست مناطق فروش ناموفق بود.");
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

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        normalizedQuery === "" ||
        row.nameFa.includes(normalizedQuery) ||
        row.nameEn.toLowerCase().includes(normalizedQuery) ||
        row.code.toLowerCase().includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || (statusFilter === "active" ? row.isActive : !row.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [rows, query, statusFilter]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(row: Territory) {
    setEditingId(row.id);
    setForm({
      code: row.code,
      nameEn: row.nameEn,
      nameFa: row.nameFa,
      isActive: row.isActive,
      sortOrder: String(row.sortOrder),
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.code.trim() || !form.nameEn.trim() || !form.nameFa.trim()) {
      pushError("کد، نام انگلیسی و نام فارسی منطقه فروش الزامی است.");
      return;
    }
    const sortOrderText = form.sortOrder.trim();
    // Blank sortOrder on create means "append at the end" (server picks it);
    // on edit the current value is prefilled, so blank is an input error.
    if (sortOrderText === "" && editingId) {
      pushError("ترتیب نمایش الزامی است.");
      return;
    }
    const sortOrder = sortOrderText === "" ? undefined : Number(sortOrderText);
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      pushError("ترتیب نمایش باید عدد صحیح و نامنفی باشد.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        nameEn: form.nameEn.trim(),
        nameFa: form.nameFa.trim(),
        isActive: form.isActive,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      };
      await apiFetch(editingId ? `/territories/${editingId}` : "/territories", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingId ? "منطقه فروش با موفقیت ویرایش شد." : "منطقه فروش جدید با موفقیت ایجاد شد.");
      closeForm();
      await loadAll();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره منطقه فروش ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به مناطق فروش را ندارید.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">مناطق فروش</h1>
            <p className="mt-2 text-sm text-muted-foreground">مناطق فروش برای طبقه‌بندی جغرافیایی مشتریان (اختیاری برای هر مشتری)</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن منطقه فروش
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست مناطق فروش</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی منطقه فروش</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس نام یا کد"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="territories-status-filter" className="shrink-0 text-xs text-muted-foreground">
                  وضعیت
                </Label>
                <select
                  id="territories-status-filter"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                >
                  <option value="all">همه</option>
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                </select>
              </div>
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
            ) : loadError ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 p-10 text-center">
                <p className="text-sm text-destructive" role="alert">
                  {loadError}
                </p>
                <Button variant="outline" size="sm" onClick={() => void loadAll()}>
                  تلاش مجدد
                </Button>
              </div>
            ) : filteredRows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? "هنوز موردی ثبت نشده است." : "موردی با این مشخصات یافت نشد."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[42rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">نام فارسی</th>
                      <th className="px-4 py-3 font-medium">نام انگلیسی</th>
                      <th className="px-4 py-3 font-medium">کد</th>
                      <th className="px-4 py-3 font-medium">ترتیب نمایش</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.map((row) => (
                      <tr key={row.id} className={row.isActive ? "hover:bg-muted/30" : "text-muted-foreground hover:bg-muted/30"}>
                        <td className="px-4 py-3 font-medium">{row.nameFa}</td>
                        <td className="px-4 py-3" dir="ltr">
                          <span className="block text-right">{row.nameEn}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.code}</td>
                        <td className="px-4 py-3">{row.sortOrder.toLocaleString("fa-IR")}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs ${
                              row.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {row.isActive ? "فعال" : "غیرفعال"}
                          </span>
                        </td>
                        {canManage ? (
                          <td className="px-4 py-3">
                            <Button variant="link" size="sm" onClick={() => openEditForm(row)}>
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
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "ویرایش منطقه فروش" : "افزودن منطقه فروش کالای جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="territories-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveRow} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="territories-code">کد</Label>
                <Input id="territories-code" dir="ltr" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="territories-sort-order">ترتیب نمایش</Label>
                <Input
                  id="territories-sort-order"
                  type="number"
                  min={0}
                  step={1}
                  dir="ltr"
                  placeholder={editingId ? undefined : "خالی = انتهای فهرست"}
                  value={form.sortOrder}
                  onChange={(event) => update("sortOrder", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="territories-name-fa">نام فارسی</Label>
                <Input id="territories-name-fa" value={form.nameFa} onChange={(event) => update("nameFa", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="territories-name-en">نام انگلیسی</Label>
                <Input id="territories-name-en" dir="ltr" value={form.nameEn} onChange={(event) => update("nameEn", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label htmlFor="territories-is-active" className="flex items-center gap-2 text-sm">
                  <input
                    id="territories-is-active"
                    type="checkbox"
                    className="size-4"
                    checked={form.isActive}
                    onChange={(event) => update("isActive", event.target.checked)}
                  />
                  فعال
                </label>
                <p className="text-xs text-muted-foreground">منطقه غیرفعال در فهرست انتخاب منطقه در فرم مشتری نمایش داده نمی‌شود.</p>
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="territories-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد منطقه فروش"}
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
