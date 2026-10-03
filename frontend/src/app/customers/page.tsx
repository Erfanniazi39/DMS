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

// Must match the backend CustomerType enum. Deliberately no status and no
// bank-information fields (held back by request — see database_plan.txt).
type CustomerType = "retail" | "wholesale" | "distributor" | "other";
type Customer = {
  id: number;
  code: string;
  name: string;
  customerType: CustomerType;
  phone: string;
  email: string | null;
  address: string | null;
  note: string | null;
};
type FormState = {
  code: string;
  name: string;
  customerType: CustomerType | "";
  phone: string;
  email: string;
  address: string;
  note: string;
};
type TypeFilter = "all" | CustomerType;

const emptyForm: FormState = { code: "", name: "", customerType: "", phone: "", email: "", address: "", note: "" };
const customerTypeLabels: Record<CustomerType, string> = {
  retail: "خرده‌فروشی",
  wholesale: "عمده‌فروشی",
  distributor: "توزیع‌کننده",
  other: "سایر",
};
const customerTypes = Object.keys(customerTypeLabels) as CustomerType[];
// Same pattern the backend's z.string().email() uses (zod v4 core regexes),
// so a value passing here is never rejected by the server for its format.
const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
// Same digits-only 6–15 rule as the backend DTO.
const PHONE_PATTERN = /^[0-9]{6,15}$/;
const textareaClass = "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";
const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

export default function CustomersPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("customers.view") ?? false;
  // Write actions (create/edit/delete) are hidden without customers.manage —
  // the backend would reject them anyway, this just avoids offering them.
  const canManage = user?.permissions.includes("customers.manage") ?? false;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // Server-side pagination + filtering (GET /customers?q=&customerType=&page=&
  // pageSize=) — same pattern as the Suppliers list.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Bumped to re-fetch the current page in place (after create/edit/delete).
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(query);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  function reloadCustomers() {
    setReloadKey((current) => current + 1);
  }

  useEffect(() => {
    if (!canView) return;
    // Ignore a response that arrives after a newer request was started
    // (fast paging / typing) so the table never shows a stale page.
    let cancelled = false;
    async function loadCustomers() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (typeFilter !== "all") params.set("customerType", typeFilter);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<Customer>>(`/customers?${params.toString()}`);
        if (cancelled) return;
        // Current page fell past the end (e.g. its last row was deleted) —
        // jump to the new last page instead of showing an empty table.
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setCustomers(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست مشتریان ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Only a changed search text is debounced; paging/filter/reloads are immediate.
    const queryChanged = query !== lastQueryRef.current;
    lastQueryRef.current = query;
    const timeout = setTimeout(() => void loadCustomers(), queryChanged && query.trim() ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, query, typeFilter, page, reloadKey]);

  const hasActiveFilters = query.trim() !== "" || typeFilter !== "all";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(event: MouseEvent, customer: Customer) {
    event.stopPropagation();
    setEditingId(customer.id);
    setForm({
      code: customer.code,
      name: customer.name,
      customerType: customer.customerType,
      phone: customer.phone,
      email: customer.email ?? "",
      address: customer.address ?? "",
      note: customer.note ?? "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  // The form is noValidate — these checks replace the browser's native
  // required/type="email" tooltips with Persian toast messages.
  function validateForm(): string[] {
    const errors: string[] = [];
    if (!form.code.trim()) errors.push("کد مشتری الزامی است.");
    if (!form.name.trim()) errors.push("نام مشتری الزامی است.");
    if (!form.customerType) errors.push("نوع مشتری را انتخاب کنید.");
    if (!form.phone.trim()) errors.push("تلفن الزامی است.");
    else if (!PHONE_PATTERN.test(form.phone.trim())) errors.push("تلفن معتبر نیست (۶ تا ۱۵ رقم انگلیسی).");
    // Email stays optional; only a provided value is format-checked.
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.push("ایمیل معتبر نیست.");
    return errors;
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateForm();
    if (errors.length) {
      pushErrors(errors);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        customerType: form.customerType,
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        note: form.note.trim(),
      };
      await apiFetch(editingId ? `/customers/${editingId}` : "/customers", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingId ? "اطلاعات مشتری با موفقیت ویرایش شد." : "مشتری جدید با موفقیت ایجاد شد.");
      closeForm();
      reloadCustomers();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره مشتری ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer(event: MouseEvent, customer: Customer) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف مشتری «${customer.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/customers/${customer.id}`, { method: "DELETE" });
      pushSuccess(`مشتری «${customer.name}» حذف شد.`);
      if (detailCustomer?.id === customer.id) setDetailCustomer(null);
      reloadCustomers();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف مشتری ناموفق بود.");
    }
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به مشتریان را ندارید.
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
            <h1 className="text-2xl font-semibold">مشتریان</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت اطلاعات مشتریان شرکت</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن مشتری
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست مشتریان</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی مشتری</span>
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
                <Label htmlFor="customer-type-filter" className="shrink-0 text-xs text-muted-foreground">
                  نوع مشتری
                </Label>
                <select
                  id="customer-type-filter"
                  className={selectClass}
                  value={typeFilter}
                  onChange={(event) => {
                    setTypeFilter(event.target.value as TypeFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">همه</option>
                  {customerTypes.map((type) => (
                    <option key={type} value={type}>
                      {customerTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Full placeholder only on the first load; later fetches (paging,
                filtering) keep the current rows visible but dimmed. */}
            {loading && customers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری مشتریان...</p>
            ) : customers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {hasActiveFilters ? "مشتری‌ای با این مشخصات یافت نشد." : "هنوز مشتری‌ای ثبت نشده است."}
              </p>
            ) : (
              <div
                className={`overflow-x-auto rounded-lg border border-border transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}
                aria-busy={loading}
              >
                <table className="w-full min-w-[48rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">مشتری</th>
                      <th className="px-4 py-3 font-medium">نوع مشتری</th>
                      <th className="px-4 py-3 font-medium">تلفن</th>
                      <th className="px-4 py-3 font-medium">ایمیل</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customers.map((customer) => (
                      <tr key={customer.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetailCustomer(customer)}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{customer.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{customer.code}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{customerTypeLabels[customer.customerType]}</td>
                        <td className="px-4 py-3 text-muted-foreground">{customer.phone || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{customer.email || "-"}</td>
                        {canManage ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button variant="link" size="sm" onClick={(event) => openEditForm(event, customer)}>
                                ویرایش
                              </Button>
                              <Button variant="destructive" size="sm" onClick={(event) => void deleteCustomer(event, customer)}>
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
            {customers.length > 0 ? (
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
            <DialogTitle>{editingId ? "ویرایش مشتری" : "افزودن مشتری جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="customer-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveCustomer} noValidate>
              <div className="md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">اطلاعات اصلی</h3>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-code">کد</Label>
                <Input id="customer-code" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-name">نام</Label>
                <Input id="customer-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-type">نوع مشتری</Label>
                <select
                  id="customer-type"
                  className={selectClass}
                  value={form.customerType}
                  onChange={(event) => update("customerType", event.target.value as CustomerType | "")}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {customerTypes.map((type) => (
                    <option key={type} value={type}>
                      {customerTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-1 border-t border-border pt-3 md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">اطلاعات تماس</h3>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-phone">تلفن</Label>
                <Input
                  id="customer-phone"
                  inputMode="numeric"
                  maxLength={15}
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-email">ایمیل</Label>
                <Input id="customer-email" type="email" dir="ltr" value={form.email} onChange={(event) => update("email", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="customer-address">آدرس</Label>
                <textarea id="customer-address" className={textareaClass} value={form.address} onChange={(event) => update("address", event.target.value)} />
              </div>

              <div className="mt-1 border-t border-border pt-3 md:col-span-2">
                <h3 className="text-sm font-medium text-foreground">یادداشت</h3>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="customer-note">یادداشت</Label>
                <textarea id="customer-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="customer-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد مشتری"}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailCustomer !== null}
        onOpenChange={(open) => {
          if (!open) setDetailCustomer(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailCustomer?.name ?? "جزئیات مشتری"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailCustomer ? (
              <div className="space-y-5">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات اصلی</h3>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">نام مشتری</dt>
                      <dd className="mt-1 font-medium">{detailCustomer.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">کد</dt>
                      <dd className="mt-1 font-mono">{detailCustomer.code}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">نوع مشتری</dt>
                      <dd className="mt-1">{customerTypeLabels[detailCustomer.customerType]}</dd>
                    </div>
                  </dl>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات تماس</h3>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">تلفن</dt>
                      <dd className="mt-1">{detailCustomer.phone || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">ایمیل</dt>
                      <dd className="mt-1">{detailCustomer.email || "-"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">آدرس</dt>
                      <dd className="mt-1 whitespace-pre-wrap">{detailCustomer.address || "-"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">یادداشت</h3>
                  <p className="whitespace-pre-wrap text-sm">{detailCustomer.note || "-"}</p>
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailCustomer(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
