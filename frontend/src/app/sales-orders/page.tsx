"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { ColorLegend, StatusBadge, toneCellClasses } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { employeeFullName } from "@/lib/reference-options";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  SALES_DELIVERY_STATUSES,
  SALES_INVOICING_STATUSES,
  SALES_ORDER_STATUSES,
  SALES_PAYMENT_STATUSES,
  salesDeliveryStatusLabels,
  salesDeliveryStatusTone,
  salesInvoicingStatusLabels,
  salesInvoicingStatusTone,
  salesOrderStatusLabels,
  salesOrderStatusTone,
  salesOrderTitle,
  salesPaymentStatusLabels,
  salesPaymentStatusTone,
  type SalesDeliveryStatus,
  type SalesInvoicingStatus,
  type SalesOrderListItem,
  type SalesOrderStatus,
  type SalesPaymentStatus,
} from "./shared";

// Same dense toolbar sizing as the Purchases list.
const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterState = {
  q: string;
  status: "" | SalesOrderStatus;
  deliveryStatus: "" | SalesDeliveryStatus;
  invoicingStatus: "" | SalesInvoicingStatus;
  paymentStatus: "" | SalesPaymentStatus;
  dateFrom: string;
  dateTo: string;
};

const emptyFilters: FilterState = { q: "", status: "", deliveryStatus: "", invoicingStatus: "", paymentStatus: "", dateFrom: "", dateTo: "" };

// سفارش‌های فروش — GET /sales-orders (sales.view), server-side pagination and
// filters. Only a DRAFT can be edited or deleted (sales.manage); every other
// status change happens through the detail page's action buttons.
export default function SalesOrdersPage() {
  const router = useRouter();
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canManage = user?.permissions.includes("sales.manage") ?? false;

  const [orders, setOrders] = useState<SalesOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(filters.q);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.status) params.set("status", filters.status);
        if (filters.deliveryStatus) params.set("deliveryStatus", filters.deliveryStatus);
        if (filters.invoicingStatus) params.set("invoicingStatus", filters.invoicingStatus);
        if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<SalesOrderListItem>>(`/sales-orders?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setOrders(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست سفارش‌های فروش ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const queryChanged = filters.q !== lastQueryRef.current;
    lastQueryRef.current = filters.q;
    const timeout = setTimeout(() => void load(), queryChanged && filters.q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [filters, page, reloadKey, canView]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function deleteDraft(event: MouseEvent, order: SalesOrderListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف «${salesOrderTitle(order)}» (${order.customerName}) مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/sales-orders/${order.id}`, { method: "DELETE" });
      pushSuccess(`«${salesOrderTitle(order)}» حذف شد.`);
      setReloadKey((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سفارش ناموفق بود.");
    }
  }

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  if (!canView) return <NoAccess message="اجازه مشاهده سفارش‌های فروش را ندارید." />;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">سفارش‌های فروش</h1>
            <p className="mt-1 text-sm text-muted-foreground">ثبت، تأیید و پیگیری سفارش‌های مشتریان</p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => router.push("/sales-orders/quick-sale")}>
                فروش نقدی سریع
              </Button>
              <Button onClick={() => router.push("/sales-orders/new")}>
                <Plus className="size-4" aria-hidden="true" />
                سفارش فروش جدید
              </Button>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-64 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی سفارش فروش</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره سفارش، مشتری یا شماره مرجع"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
              <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
                <option value="">همه</option>
                {SALES_ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>{salesOrderStatusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-delivery" className={toolbarFieldLabel}>تحویل</Label>
              <select id="filter-delivery" className={toolbarSelectClass} value={filters.deliveryStatus} onChange={(event) => updateFilter("deliveryStatus", event.target.value as FilterState["deliveryStatus"])}>
                <option value="">همه</option>
                {SALES_DELIVERY_STATUSES.map((status) => (
                  <option key={status} value={status}>{salesDeliveryStatusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-invoicing" className={toolbarFieldLabel}>فاکتور</Label>
              <select id="filter-invoicing" className={toolbarSelectClass} value={filters.invoicingStatus} onChange={(event) => updateFilter("invoicingStatus", event.target.value as FilterState["invoicingStatus"])}>
                <option value="">همه</option>
                {SALES_INVOICING_STATUSES.map((status) => (
                  <option key={status} value={status}>{salesInvoicingStatusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-payment" className={toolbarFieldLabel}>پرداخت</Label>
              <select id="filter-payment" className={toolbarSelectClass} value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as FilterState["paymentStatus"])}>
                <option value="">همه</option>
                {SALES_PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{salesPaymentStatusLabels[status]}</option>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => {
                  setFilters(emptyFilters);
                  setPage(1);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {orders.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-2">
              <ColorLegend
                title="رنگ ستون وضعیت"
                items={SALES_ORDER_STATUSES.map((status) => ({ label: salesOrderStatusLabels[status], tone: salesOrderStatusTone[status] }))}
              />
            </div>
          ) : null}

          {loadError && orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <p className="text-sm text-destructive" role="alert">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
            </div>
          ) : loading && orders.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری سفارش‌ها...</p>
          ) : orders.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {hasActiveFilters ? "سفارشی با این مشخصات یافت نشد." : "هنوز سفارش فروشی ثبت نشده است."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">شماره سفارش</th>
                    <th className="px-3 py-2.5 font-medium">تاریخ</th>
                    <th className="px-3 py-2.5 font-medium">مشتری</th>
                    <th className="px-3 py-2.5 font-medium">فروشنده</th>
                    <th className="px-3 py-2.5 font-medium">ردیف</th>
                    <th className="px-3 py-2.5 font-medium">مبلغ کل</th>
                    <th className="px-3 py-2.5 font-medium">وضعیت</th>
                    <th className="px-3 py-2.5 font-medium">تحویل</th>
                    <th className="px-3 py-2.5 font-medium">فاکتور</th>
                    <th className="px-3 py-2.5 font-medium">پرداخت</th>
                    <th className="px-3 py-2.5 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => {
                    const editable = canManage && order.status === "DRAFT";
                    return (
                      <tr key={order.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/sales-orders/${order.id}`)}>
                        <td className={`px-3 py-2.5 whitespace-nowrap ${order.orderNumber ? "font-mono text-xs" : "text-xs text-muted-foreground"}`}>{salesOrderTitle(order)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(order.orderDate)}</td>
                        <td className="px-3 py-2.5">
                          <bdi>{order.customerName}</bdi>{" "}
                          <bdi className="font-mono text-[11px] text-muted-foreground">{order.customer.customerNumber}</bdi>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{order.salespersonEmployee ? employeeFullName(order.salespersonEmployee) : "-"}</td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{order._count.items.toLocaleString("fa-IR")}</td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap tabular-nums">{formatMoney(order.totalAmount)} ریال</td>
                        <td className={`px-3 py-2.5 ${toneCellClasses[salesOrderStatusTone[order.status]]}`}>
                          <StatusBadge label={salesOrderStatusLabels[order.status]} tone={salesOrderStatusTone[order.status]} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={salesDeliveryStatusLabels[order.deliveryStatus]} tone={salesDeliveryStatusTone[order.deliveryStatus]} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={salesInvoicingStatusLabels[order.invoicingStatus]} tone={salesInvoicingStatusTone[order.invoicingStatus]} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={salesPaymentStatusLabels[order.paymentStatus]} tone={salesPaymentStatusTone[order.paymentStatus]} />
                        </td>
                        <td className="px-3 py-2.5">
                          {editable ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  router.push(`/sales-orders/${order.id}/edit`);
                                }}
                              >
                                ویرایش
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={(event) => void deleteDraft(event, order)}
                              >
                                حذف
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {orders.length > 0 ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
