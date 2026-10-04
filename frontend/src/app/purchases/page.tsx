"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  PURCHASE_PAYMENT_STATUSES,
  PURCHASE_SOURCE_TYPES,
  PURCHASE_STATUSES,
  StatusBadge,
  employeeFullName,
  formatMoney,
  purchaseItemsSummary,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseSourceTypeLabels,
  purchaseSourceTypeTone,
  purchaseStatusLabels,
  purchaseStatusTone,
  type PurchaseListItem,
  type PurchasePaymentStatus,
  type PurchaseSourceType,
  type PurchaseStatus,
  type PurchaseTypeOption,
  type SupplierOption,
} from "./shared";

// Purchases-list-only control sizing — a touch more compact than the shared
// selectClass/textareaClass in ./shared (also used by the Purchase Request
// module), kept local here on purpose so this denser toolbar never changes
// how any other page's selects look.
const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterState = {
  q: string;
  purchaseTypeId: string;
  status: "" | PurchaseStatus;
  paymentStatus: "" | PurchasePaymentStatus;
  sourceType: "" | PurchaseSourceType;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
};

const emptyFilters: FilterState = {
  q: "",
  purchaseTypeId: "",
  status: "",
  paymentStatus: "",
  sourceType: "",
  supplierId: "",
  dateFrom: "",
  dateTo: "",
};

export default function PurchasesPage() {
  const router = useRouter();
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("purchases.view") ?? false;
  const canCreate = user?.permissions.includes("purchases.manage") ?? false;
  const canEdit = user?.permissions.includes("purchases.edit") ?? false;
  const canDelete = canCreate;
  // The supplier filter needs GET /suppliers (suppliers.view) — without it
  // the filter just offers "همه" instead of failing the whole options load.
  const canViewSuppliers = user?.permissions.includes("suppliers.view") ?? false;

  const [purchases, setPurchases] = useState<PurchaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  // Server-side pagination (GET /purchases?page=&pageSize=). Any filter
  // change resets to page 1 — see updateFilter()/clearFilters().
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Bumped to re-fetch the current page in place (e.g. after a delete).
  const [reloadKey, setReloadKey] = useState(0);
  // Only a changed search text is debounced — paging, other filters and
  // reloads fetch immediately even while a search is active.
  const lastQueryRef = useRef(filters.q);

  const [purchaseTypes, setPurchaseTypes] = useState<PurchaseTypeOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  useEffect(() => {
    if (!canView) return;
    async function loadFilterOptions() {
      try {
        const [purchaseTypesData, suppliersData] = await Promise.all([
          apiFetch<PurchaseTypeOption[]>("/purchase-types"),
          canViewSuppliers ? apiFetch<SupplierOption[]>("/suppliers") : Promise.resolve([]),
        ]);
        setPurchaseTypes(purchaseTypesData);
        setSuppliers(suppliersData);
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات فیلترها ناموفق بود.");
      }
    }
    void loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewSuppliers]);

  useEffect(() => {
    if (!canView) return;
    // Ignore a response that arrives after a newer request was started
    // (fast paging / typing) so the table never shows a stale page.
    let cancelled = false;
    async function loadPurchases() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.purchaseTypeId) params.set("purchaseTypeId", filters.purchaseTypeId);
        if (filters.status) params.set("status", filters.status);
        if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
        if (filters.sourceType) params.set("sourceType", filters.sourceType);
        if (filters.supplierId) params.set("supplierId", filters.supplierId);
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<PurchaseListItem>>(`/purchases?${params.toString()}`);
        if (cancelled) return;
        // Current page fell past the end (e.g. its last row was deleted) —
        // jump to the new last page instead of showing an empty table.
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setPurchases(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست خریدها ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const queryChanged = filters.q !== lastQueryRef.current;
    lastQueryRef.current = filters.q;
    const timeout = setTimeout(() => void loadPurchases(), queryChanged && filters.q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, reloadKey, canView]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setPage(1);
  }

  async function deletePurchase(event: MouseEvent, purchase: PurchaseListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف خرید «${purchase.purchaseNumber}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/purchases/${purchase.id}`, { method: "DELETE" });
      pushSuccess(`خرید «${purchase.purchaseNumber}» حذف شد.`);
      // Re-fetch the current page so it refills from the next one (and the
      // total stays correct) instead of just dropping the row locally.
      setReloadKey((current) => current + 1);
    } catch (reason) {
      // The backend rejects deletion when the purchase has payments or
      // documents attached (see PurchasesService.remove()) — that message
      // is shown here as-is.
      pushError((reason as ApiError).message ?? "حذف خرید ناموفق بود.");
    }
  }

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به خریدها را ندارید.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">خریدها</h1>
            <p className="mt-1 text-sm text-muted-foreground">مدیریت و پیگیری خریدهای شرکت</p>
          </div>
          {canCreate ? (
            <Button onClick={() => router.push("/purchases/new")}>
              <Plus className="size-4" aria-hidden="true" />
              خرید جدید
            </Button>
          ) : null}
        </div>

        {/* Toolbar + table share one plain bordered surface — no nested
            card title, no extra chrome; the toolbar row is a thin band
            above the table, sized for frequent use rather than decoration. */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-60 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی خرید</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره خرید یا تأمین‌کننده"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت خرید</Label>
              <select
                id="filter-status"
                className={toolbarSelectClass}
                value={filters.status}
                onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}
              >
                <option value="">همه</option>
                {PURCHASE_STATUSES.map((status) => (
                  <option key={status} value={status}>{purchaseStatusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-payment-status" className={toolbarFieldLabel}>وضعیت پرداخت</Label>
              <select
                id="filter-payment-status"
                className={toolbarSelectClass}
                value={filters.paymentStatus}
                onChange={(event) => updateFilter("paymentStatus", event.target.value as FilterState["paymentStatus"])}
              >
                <option value="">همه</option>
                {PURCHASE_PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{purchasePaymentStatusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-purchase-type" className={toolbarFieldLabel}>نوع خرید</Label>
              <select
                id="filter-purchase-type"
                className={toolbarSelectClass}
                value={filters.purchaseTypeId}
                onChange={(event) => updateFilter("purchaseTypeId", event.target.value)}
              >
                <option value="">همه</option>
                {purchaseTypes.map((type) => (
                  <option key={type.id} value={type.id}>{type.nameFa}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-supplier" className={toolbarFieldLabel}>تأمین‌کننده</Label>
              <select
                id="filter-supplier"
                className={toolbarSelectClass}
                value={filters.supplierId}
                onChange={(event) => updateFilter("supplierId", event.target.value)}
              >
                <option value="">همه</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-source-type" className={toolbarFieldLabel}>نوع ثبت</Label>
              <select
                id="filter-source-type"
                className={toolbarSelectClass}
                value={filters.sourceType}
                onChange={(event) => updateFilter("sourceType", event.target.value as FilterState["sourceType"])}
              >
                <option value="">همه</option>
                {PURCHASE_SOURCE_TYPES.map((sourceType) => (
                  <option key={sourceType} value={sourceType}>{purchaseSourceTypeLabels[sourceType]}</option>
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

          {/* Full placeholder only on the first load; later fetches (paging,
              filtering) keep the current rows visible but dimmed. */}
          {loading && purchases.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری خریدها...</p>
          ) : purchases.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {hasActiveFilters ? "خریدی با این مشخصات یافت نشد." : "هنوز خریدی ثبت نشده است."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">شماره خرید</th>
                    <th className="px-3 py-2.5 font-medium">تاریخ</th>
                    <th className="px-3 py-2.5 font-medium">تأمین‌کننده</th>
                    <th className="px-3 py-2.5 font-medium">نوع خرید</th>
                    <th className="px-3 py-2.5 font-medium">قلم</th>
                    <th className="px-3 py-2.5 font-medium">خریدار</th>
                    <th className="px-3 py-2.5 font-medium">مبلغ کل</th>
                    <th className="px-3 py-2.5 font-medium">پرداخت</th>
                    <th className="px-3 py-2.5 font-medium">وضعیت</th>
                    <th className="px-3 py-2.5 font-medium">نوع ثبت</th>
                    <th className="px-3 py-2.5 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {purchases.map((purchase) => (
                    <tr
                      key={purchase.id}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                      onClick={() => router.push(`/purchases/${purchase.id}`)}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-foreground">{purchase.purchaseNumber}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(purchase.purchaseDate)}</td>
                      <td className="px-3 py-2.5">{purchase.supplier.name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{purchase.purchaseType.nameFa}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{purchaseItemsSummary(purchase)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {purchase.buyerEmployee ? employeeFullName(purchase.buyerEmployee) : "-"}
                      </td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap tabular-nums">{formatMoney(purchase.totalAmount)} ریال</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge label={purchasePaymentStatusLabels[purchase.paymentStatus]} tone={purchasePaymentStatusTone[purchase.paymentStatus]} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge label={purchaseStatusLabels[purchase.status]} tone={purchaseStatusTone[purchase.status]} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge label={purchaseSourceTypeLabels[purchase.sourceType]} tone={purchaseSourceTypeTone[purchase.sourceType]} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/purchases/${purchase.id}/edit`);
                              }}
                            >
                              ویرایش
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={(event) => void deletePurchase(event, purchase)}
                            >
                              حذف
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {purchases.length > 0 ? (
            <ListPagination
              className="border-t border-border px-4 py-2.5"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              total={total}
              loading={loading}
              onPageChange={setPage}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
