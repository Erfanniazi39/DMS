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
import { useAdminUser } from "@/app/admin/layout";

type SupplierStatus = "active" | "inactive" | "blacklisted";
type Supplier = {
  id: number;
  code: string;
  name: string;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankShebaNumber: string | null;
  status: SupplierStatus;
  note: string | null;
};
type FormState = {
  code: string;
  name: string;
  nationalId: string;
  phone: string;
  email: string;
  address: string;
  bankName: string;
  bankAccountNumber: string;
  bankShebaNumber: string;
  note: string;
  status: SupplierStatus;
};
type StatusFilter = "all" | SupplierStatus;

const emptyForm: FormState = {
  code: "",
  name: "",
  nationalId: "",
  phone: "",
  email: "",
  address: "",
  bankName: "",
  bankAccountNumber: "",
  bankShebaNumber: "",
  note: "",
  status: "active",
};
const statusLabels: Record<SupplierStatus, string> = { active: "فعال", inactive: "غیرفعال", blacklisted: "لیست سیاه" };
// Same pattern the backend's z.string().email() uses (zod v4 core regexes),
// so a value passing here is never rejected by the server for its format.
const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const textareaClass = "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";

export default function SuppliersPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("suppliers.view") ?? false;
  // Write actions (create/edit/delete) are hidden without suppliers.manage —
  // the backend would reject them anyway, this just avoids offering them.
  const canManage = user?.permissions.includes("suppliers.manage") ?? false;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Server-side pagination + filtering (GET /suppliers?q=&status=&page=&
  // pageSize=). Search and status run on the server so they apply across
  // every page, not just the rows currently loaded; changing either resets
  // to page 1.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Bumped to re-fetch the current page in place (after create/edit/delete).
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(query);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);

  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  function reloadSuppliers() {
    setReloadKey((current) => current + 1);
  }

  useEffect(() => {
    if (!canView) return;
    // Ignore a response that arrives after a newer request was started
    // (fast paging / typing) so the table never shows a stale page.
    let cancelled = false;
    async function loadSuppliers() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<Supplier>>(`/suppliers?${params.toString()}`);
        if (cancelled) return;
        // Current page fell past the end (e.g. its last row was deleted) —
        // jump to the new last page instead of showing an empty table.
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setSuppliers(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست تأمین‌کنندگان ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Only a changed search text is debounced; paging/status/reloads are immediate.
    const queryChanged = query !== lastQueryRef.current;
    lastQueryRef.current = query;
    const timeout = setTimeout(() => void loadSuppliers(), queryChanged && query.trim() ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, query, statusFilter, page, reloadKey]);

  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(event: MouseEvent, supplier: Supplier) {
    event.stopPropagation();
    setEditingId(supplier.id);
    setForm({
      code: supplier.code,
      name: supplier.name,
      nationalId: supplier.nationalId ?? "",
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      address: supplier.address ?? "",
      bankName: supplier.bankName ?? "",
      bankAccountNumber: supplier.bankAccountNumber ?? "",
      bankShebaNumber: supplier.bankShebaNumber ?? "",
      note: supplier.note ?? "",
      status: supplier.status,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      pushError("کد و نام تأمین‌کننده الزامی است.");
      return;
    }
    // Email stays optional; only a provided value is format-checked. The
    // form is noValidate, so this replaces the browser's type="email" check.
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
      pushError("ایمیل معتبر نیست.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        nationalId: form.nationalId.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        bankName: form.bankName.trim(),
        bankAccountNumber: form.bankAccountNumber.trim(),
        bankShebaNumber: form.bankShebaNumber.trim(),
        note: form.note.trim(),
        ...(editingId ? { status: form.status } : {}),
      };
      await apiFetch(editingId ? `/suppliers/${editingId}` : "/suppliers", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingId ? "اطلاعات تأمین‌کننده با موفقیت ویرایش شد." : "تأمین‌کننده جدید با موفقیت ایجاد شد.");
      closeForm();
      reloadSuppliers();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره تأمین‌کننده ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(event: MouseEvent, supplier: Supplier) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف تأمین‌کننده «${supplier.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/suppliers/${supplier.id}`, { method: "DELETE" });
      pushSuccess(`تأمین‌کننده «${supplier.name}» حذف شد.`);
      if (detailSupplier?.id === supplier.id) setDetailSupplier(null);
      reloadSuppliers();
    } catch (reason) {
      // The backend already rejects deletion when the supplier is referenced
      // elsewhere (see SuppliersService.remove()) and surfaces a clear
      // Persian message for it — shown here as-is.
      pushError((reason as ApiError).message ?? "حذف تأمین‌کننده ناموفق بود.");
    }
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به تأمین‌کنندگان را ندارید.
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
            <h1 className="text-2xl font-semibold">تأمین‌کنندگان</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت اطلاعات تأمین‌کنندگان شرکت</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن تأمین‌کننده
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست تأمین‌کنندگان</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی تأمین‌کننده</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس نام، کد، تلفن یا ایمیل"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="supplier-status-filter" className="shrink-0 text-xs text-muted-foreground">
                  وضعیت
                </Label>
                <select
                  id="supplier-status-filter"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">همه</option>
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                  <option value="blacklisted">لیست سیاه</option>
                </select>
              </div>
            </div>

            {/* Full placeholder only on the first load; later fetches (paging,
                filtering) keep the current rows visible but dimmed. */}
            {loading && suppliers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری تأمین‌کنندگان...</p>
            ) : suppliers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {hasActiveFilters ? "تأمین‌کننده‌ای با این مشخصات یافت نشد." : "هنوز تأمین‌کننده‌ای ثبت نشده است."}
              </p>
            ) : (
              <div
                className={`overflow-x-auto rounded-lg border border-border transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}
                aria-busy={loading}
              >
                <table className="w-full min-w-[52rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">تأمین‌کننده</th>
                      <th className="px-4 py-3 font-medium">تلفن</th>
                      <th className="px-4 py-3 font-medium">ایمیل</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      <th className="px-4 py-3 font-medium">آخرین خرید</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetailSupplier(supplier)}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{supplier.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{supplier.code}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{supplier.phone || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{supplier.email || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{statusLabels[supplier.status]}</td>
                        {/* No Purchases module yet (project roadmap phase 5) — there is
                            no purchase history to derive this from until it exists. */}
                        <td className="px-4 py-3 text-muted-foreground">-</td>
                        {canManage ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button variant="link" size="sm" onClick={(event) => openEditForm(event, supplier)}>
                                ویرایش
                              </Button>
                              <Button variant="destructive" size="sm" onClick={(event) => void deleteSupplier(event, supplier)}>
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
            {suppliers.length > 0 ? (
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
            <DialogTitle>{editingId ? "ویرایش تأمین‌کننده" : "افزودن تأمین‌کننده جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="supplier-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveSupplier} noValidate>
              <div className="md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">اطلاعات اصلی</h3>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-code">کد تأمین‌کننده</Label>
                <Input id="supplier-code" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-name">نام تأمین‌کننده</Label>
                <Input id="supplier-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-national-id">شناسه ملی</Label>
                <Input
                  id="supplier-national-id"
                  inputMode="numeric"
                  maxLength={11}
                  value={form.nationalId}
                  onChange={(event) => update("nationalId", event.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              {editingId ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="supplier-status">وضعیت</Label>
                  <select
                    id="supplier-status"
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.status}
                    onChange={(event) => update("status", event.target.value as SupplierStatus)}
                  >
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                    <option value="blacklisted">لیست سیاه</option>
                  </select>
                </div>
              ) : null}

              <div className="mt-1 border-t border-border pt-3 md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">اطلاعات تماس</h3>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-phone">تلفن</Label>
                <Input id="supplier-phone" inputMode="numeric" value={form.phone} onChange={(event) => update("phone", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-email">ایمیل</Label>
                <Input id="supplier-email" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="supplier-address">آدرس</Label>
                <textarea id="supplier-address" className={textareaClass} value={form.address} onChange={(event) => update("address", event.target.value)} />
              </div>

              <div className="mt-1 border-t border-border pt-3 md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">اطلاعات بانکی</h3>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-bank-name">نام بانک</Label>
                <Input id="supplier-bank-name" value={form.bankName} onChange={(event) => update("bankName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-bank-account-number">شماره حساب</Label>
                <Input
                  id="supplier-bank-account-number"
                  value={form.bankAccountNumber}
                  onChange={(event) => update("bankAccountNumber", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="supplier-bank-sheba-number">شماره شبا</Label>
                <Input
                  id="supplier-bank-sheba-number"
                  placeholder="IRxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={form.bankShebaNumber}
                  onChange={(event) => update("bankShebaNumber", event.target.value)}
                />
              </div>

              <div className="mt-1 border-t border-border pt-3 md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">یادداشت</h3>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="supplier-note">یادداشت</Label>
                <textarea id="supplier-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="supplier-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد تأمین‌کننده"}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailSupplier !== null}
        onOpenChange={(open) => {
          if (!open) setDetailSupplier(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailSupplier?.name ?? "جزئیات تأمین‌کننده"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailSupplier ? (
              <div className="space-y-5">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات اصلی</h3>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">نام تأمین‌کننده</dt>
                      <dd className="mt-1 font-medium">{detailSupplier.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">کد</dt>
                      <dd className="mt-1 font-mono">{detailSupplier.code}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">شناسه ملی</dt>
                      <dd className="mt-1 font-mono">{detailSupplier.nationalId || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">وضعیت</dt>
                      <dd className="mt-1">{statusLabels[detailSupplier.status]}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">آخرین خرید</dt>
                      <dd className="mt-1">-</dd>
                    </div>
                  </dl>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات تماس</h3>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">تلفن</dt>
                      <dd className="mt-1">{detailSupplier.phone || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">ایمیل</dt>
                      <dd className="mt-1">{detailSupplier.email || "-"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">آدرس</dt>
                      <dd className="mt-1 whitespace-pre-wrap">{detailSupplier.address || "-"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات بانکی</h3>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">نام بانک</dt>
                      <dd className="mt-1">{detailSupplier.bankName || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">شماره حساب</dt>
                      <dd className="mt-1 font-mono">{detailSupplier.bankAccountNumber || "-"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">شماره شبا</dt>
                      <dd className="mt-1 font-mono" dir="ltr">{detailSupplier.bankShebaNumber || "-"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">یادداشت</h3>
                  <p className="whitespace-pre-wrap text-sm">{detailSupplier.note || "-"}</p>
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailSupplier(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
