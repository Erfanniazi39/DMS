"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { SortHeader, useTableSort } from "@/components/ui/sortable";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { sortQuery } from "@/lib/table-sort";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { statusLabels, type SupplierListRow, type SupplierStatus } from "./_sections/shared";

type StatusFilter = "all" | SupplierStatus;

function SuppliersPageContent() {
  const user = useAdminUser();
  const router = useRouter();
  const canView = user?.permissions.includes("suppliers.view") ?? false;
  // Write actions (create/edit/delete) are hidden without suppliers.manage —
  // the backend would reject them anyway, this just avoids offering them.
  const canManage = user?.permissions.includes("suppliers.manage") ?? false;
  const [suppliers, setSuppliers] = useState<SupplierListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(useSearchParams().get("q") ?? ""); // ?q= comes from the header search
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Server-side pagination + filtering (GET /suppliers?q=&status=&page=&
  // pageSize=). Search and status run on the server so they apply across
  // every page, not just the rows currently loaded; changing either resets
  // to page 1.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Server-side column sorting (?sortBy=&sortDir=); a change returns to page 1.
  const { sort, onSort } = useTableSort(null, () => setPage(1));
  // Bumped to re-fetch the current page in place (after create/edit/delete).
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(query);

  const { toasts, pushError, pushSuccess, dismiss } = useToasts();

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
        const data = await apiFetch<Paginated<SupplierListRow>>(`/suppliers?${params.toString()}${sortQuery(sort)}`);
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
  }, [canView, query, statusFilter, page, reloadKey, sort]);

  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";

  function openEditForm(event: MouseEvent, supplier: SupplierListRow) {
    event.stopPropagation();
    router.push(`/suppliers/${supplier.id}/edit`);
  }

  async function deleteSupplier(event: MouseEvent, supplier: SupplierListRow) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف تأمین‌کننده «${supplier.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/suppliers/${supplier.id}`, { method: "DELETE" });
      pushSuccess(`تأمین‌کننده «${supplier.name}» حذف شد.`);
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
            <Button onClick={() => router.push("/suppliers/new")}>
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
                      <SortHeader label="تأمین‌کننده" sortKey="name" sort={sort} onSort={onSort} />
                      <SortHeader label="تلفن" sortKey="phone" sort={sort} onSort={onSort} />
                      <SortHeader label="ایمیل" sortKey="email" sort={sort} onSort={onSort} />
                      <SortHeader label="وضعیت" sortKey="status" sort={sort} onSort={onSort} />
                      <th className="px-4 py-3 font-medium">نوع خرید</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id} className="cursor-pointer hover:bg-muted/30" onClick={() => router.push(`/suppliers/${supplier.id}`)}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{supplier.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{supplier.code}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{supplier.phone || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{supplier.email || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{statusLabels[supplier.status]}</td>
                        <td className="px-4 py-3 text-muted-foreground">{supplier.purchaseTypes.map((type) => type.nameFa).join("، ") || "-"}</td>
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

    </div>
  );
}

export default function SuppliersPage() {
  return (
    <Suspense fallback={null}>
      <SuppliersPageContent />
    </Suspense>
  );
}
