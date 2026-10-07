"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { normalizeDigits } from "@/lib/number-input";
import { useAdminUser } from "@/app/admin/layout";

// Item = things the company produces/sells. It is NOT a purchasing catalog
// — purchase item names stay free text and never reference this list.
// List/detail need items.view; create/edit/delete need items.manage.
type ItemStatus = "active" | "inactive";
type RefOption = { id: number; code: string; nameFa: string; isActive?: boolean };
type Item = {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  unitId: number;
  category: RefOption;
  unit: RefOption;
  description: string | null;
  status: ItemStatus;
  note: string | null;
  // Default selling price (Rial). Decimal → JSON string; null = none (priced
  // manually on each sales line).
  sellingPrice: string | null;
};
type FormState = {
  code: string;
  name: string;
  categoryId: string;
  unitId: string;
  description: string;
  status: ItemStatus;
  note: string;
  sellingPrice: string;
};
type StatusFilter = "all" | ItemStatus;

const emptyForm: FormState = { code: "", name: "", categoryId: "", unitId: "", description: "", status: "active", note: "", sellingPrice: "" };
const statusLabels: Record<ItemStatus, string> = { active: "فعال", inactive: "غیرفعال" };
const textareaClass = "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";
const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

// The dropdowns list only active categories/units, but an item being edited
// may still point at one that has since been deactivated — keep it
// selectable so opening and saving the form doesn't silently change it.
function withCurrent(options: RefOption[], current: RefOption | undefined): RefOption[] {
  if (!current || options.some((option) => option.id === current.id)) return options;
  return [...options, { ...current, isActive: false }];
}

export default function ItemsPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("items.view") ?? false;
  // Write actions (create/edit/delete) are hidden without items.manage —
  // the backend would reject them anyway, this just avoids offering them.
  const canManage = user?.permissions.includes("items.manage") ?? false;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  // Server-side pagination + filtering (GET /items?q=&status=&categoryId=&
  // page=&pageSize=), same pattern as the Suppliers page. Changing any
  // filter resets to page 1.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(query);

  // Dropdown option lists — active-only GET /item-categories and GET /units.
  const [categories, setCategories] = useState<RefOption[]>([]);
  const [units, setUnits] = useState<RefOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [detailItem, setDetailItem] = useState<Item | null>(null);

  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  function reloadItems() {
    setReloadKey((current) => current + 1);
  }

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    Promise.all([apiFetch<RefOption[]>("/item-categories"), apiFetch<RefOption[]>("/units")])
      .then(([categoriesData, unitsData]) => {
        if (cancelled) return;
        setCategories(categoriesData);
        setUnits(unitsData);
      })
      .catch((reason) => {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست دسته‌بندی‌ها و واحدها ناموفق بود.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    // Ignore a response that arrives after a newer request was started
    // (fast paging / typing) so the table never shows a stale page.
    let cancelled = false;
    async function loadItems() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<Item>>(`/items?${params.toString()}`);
        if (cancelled) return;
        // Current page fell past the end (e.g. its last row was deleted) —
        // jump to the new last page instead of showing an empty table.
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setItems(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست کالاها ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Only a changed search text is debounced; paging/filters/reloads are immediate.
    const queryChanged = query !== lastQueryRef.current;
    lastQueryRef.current = query;
    const timeout = setTimeout(() => void loadItems(), queryChanged && query.trim() ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, query, statusFilter, categoryFilter, page, reloadKey]);

  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all";
  const categoryOptions = withCurrent(categories, editingItem?.category);
  const unitOptions = withCurrent(units, editingItem?.unit);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingItem(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(event: MouseEvent, item: Item) {
    event.stopPropagation();
    setEditingItem(item);
    setForm({
      code: item.code,
      name: item.name,
      categoryId: String(item.categoryId),
      unitId: String(item.unitId),
      description: item.description ?? "",
      status: item.status,
      note: item.note ?? "",
      sellingPrice: item.sellingPrice ?? "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingItem(null);
    setForm(emptyForm);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The form is noValidate — every required-field check happens here
    // with a Persian message instead of the browser's native tooltip.
    const missing: string[] = [];
    if (!form.code.trim()) missing.push("کد کالا الزامی است.");
    if (!form.name.trim()) missing.push("نام کالا الزامی است.");
    if (!form.categoryId) missing.push("انتخاب دسته‌بندی الزامی است.");
    if (!form.unitId) missing.push("انتخاب واحد الزامی است.");
    // Optional; when given, a whole Rial amount (the backend re-validates).
    const sellingPrice = normalizeDigits(form.sellingPrice).trim();
    if (sellingPrice !== "" && !/^\d+$/.test(sellingPrice)) missing.push("قیمت فروش باید عدد صحیح (ریال، بدون اعشار) باشد.");
    if (missing.length) {
      pushErrors(missing);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        categoryId: Number(form.categoryId),
        unitId: Number(form.unitId),
        description: form.description.trim(),
        status: form.status,
        note: form.note.trim(),
        // Blank = no default price (also clears it on edit).
        sellingPrice: sellingPrice === "" ? null : Number(sellingPrice),
      };
      await apiFetch(editingItem ? `/items/${editingItem.id}` : "/items", {
        method: editingItem ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingItem ? "اطلاعات کالا با موفقیت ویرایش شد." : "کالای جدید با موفقیت ایجاد شد.");
      closeForm();
      reloadItems();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره کالا ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(event: MouseEvent, item: Item) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف کالای «${item.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/items/${item.id}`, { method: "DELETE" });
      pushSuccess(`کالای «${item.name}» حذف شد.`);
      if (detailItem?.id === item.id) setDetailItem(null);
      reloadItems();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف کالا ناموفق بود.");
    }
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به کالاها را ندارید.
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
            <h1 className="text-2xl font-semibold">کالاها</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت کالاهای تولیدی و فروشی شرکت</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن کالا
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست کالاها</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کالا</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس نام یا کد"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="item-category-filter" className="shrink-0 text-xs text-muted-foreground">
                  دسته‌بندی
                </Label>
                <select
                  id="item-category-filter"
                  className={selectClass}
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">همه</option>
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.nameFa}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="item-status-filter" className="shrink-0 text-xs text-muted-foreground">
                  وضعیت
                </Label>
                <select
                  id="item-status-filter"
                  className={selectClass}
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">همه</option>
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                </select>
              </div>
            </div>

            {loading && items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری کالاها...</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {hasActiveFilters ? "کالایی با این مشخصات یافت نشد." : "هنوز کالایی ثبت نشده است."}
              </p>
            ) : (
              <div
                className={`overflow-x-auto rounded-lg border border-border transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}
                aria-busy={loading}
              >
                <table className="w-full min-w-[48rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">کالا</th>
                      <th className="px-4 py-3 font-medium">دسته‌بندی</th>
                      <th className="px-4 py-3 font-medium">واحد</th>
                      <th className="px-4 py-3 font-medium">قیمت فروش (ریال)</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => (
                      <tr key={item.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetailItem(item)}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{item.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.code}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{item.category.nameFa}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.unit.nameFa}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatMoney(item.sellingPrice)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs ${
                              item.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {statusLabels[item.status]}
                          </span>
                        </td>
                        {canManage ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button variant="link" size="sm" onClick={(event) => openEditForm(event, item)}>
                                ویرایش
                              </Button>
                              <Button variant="destructive" size="sm" onClick={(event) => void deleteItem(event, item)}>
                                حذف
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 0 ? (
              <ListPagination page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
            ) : null}
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
            <DialogTitle>{editingItem ? "ویرایش کالا" : "افزودن کالای جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="item-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveItem} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-code">کد</Label>
                <Input id="item-code" dir="ltr" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-name">نام</Label>
                <Input id="item-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-category">دسته‌بندی</Label>
                <select
                  id="item-category"
                  className={selectClass}
                  value={form.categoryId}
                  onChange={(event) => update("categoryId", event.target.value)}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.nameFa}
                      {category.isActive === false ? " (غیرفعال)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-unit">واحد</Label>
                <select id="item-unit" className={selectClass} value={form.unitId} onChange={(event) => update("unitId", event.target.value)} required>
                  <option value="">انتخاب کنید</option>
                  {unitOptions.map((unit) => (
                    <option key={unit.id} value={String(unit.id)}>
                      {unit.nameFa}
                      {unit.isActive === false ? " (غیرفعال)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-status">وضعیت</Label>
                <select
                  id="item-status"
                  className={selectClass}
                  value={form.status}
                  onChange={(event) => update("status", event.target.value as ItemStatus)}
                >
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-selling-price">قیمت فروش (ریال)</Label>
                <Input
                  id="item-selling-price"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="اختیاری"
                  value={form.sellingPrice}
                  onChange={(event) => update("sellingPrice", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="item-description">توضیحات</Label>
                <textarea
                  id="item-description"
                  className={textareaClass}
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="item-note">یادداشت</Label>
                <textarea id="item-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="item-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingItem ? "ذخیره تغییرات" : "ایجاد کالا"}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailItem !== null}
        onOpenChange={(open) => {
          if (!open) setDetailItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailItem?.name ?? "جزئیات کالا"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailItem ? (
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">نام</dt>
                    <dd className="mt-1 font-medium">{detailItem.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">کد</dt>
                    <dd className="mt-1 font-mono">{detailItem.code}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">دسته‌بندی</dt>
                    <dd className="mt-1">{detailItem.category.nameFa}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">واحد</dt>
                    <dd className="mt-1">{detailItem.unit.nameFa}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">وضعیت</dt>
                    <dd className="mt-1">{statusLabels[detailItem.status]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">قیمت فروش</dt>
                    <dd className="mt-1 tabular-nums">{detailItem.sellingPrice ? `${formatMoney(detailItem.sellingPrice)} ریال` : "-"}</dd>
                  </div>
                </dl>
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">توضیحات</h3>
                  <p className="whitespace-pre-wrap text-sm">{detailItem.description || "-"}</p>
                </div>
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">یادداشت</h3>
                  <p className="whitespace-pre-wrap text-sm">{detailItem.note || "-"}</p>
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailItem(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
