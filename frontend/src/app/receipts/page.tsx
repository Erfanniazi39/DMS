"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { RecordReceiptDialog } from "./RecordReceiptDialog";
import { RecordRefundDialog } from "./RecordRefundDialog";
import {
  customerPaymentDirectionLabels,
  customerPaymentDirectionTone,
  customerPaymentStatusLabels,
  customerPaymentStatusTone,
  customerPaymentTitle,
  NoAccess,
  paymentMethodLabels,
  CUSTOMER_PAYMENT_DIRECTIONS,
  CUSTOMER_PAYMENT_STATUSES,
  PAYMENT_METHODS,
  type CustomerPaymentDirection,
  type CustomerPaymentListItem,
  type CustomerPaymentStatus,
  type PaymentMethod,
} from "./shared";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterState = {
  q: string;
  direction: "" | CustomerPaymentDirection;
  status: "" | CustomerPaymentStatus;
  method: "" | PaymentMethod;
  dateFrom: string;
  dateTo: string;
};
const emptyFilters: FilterState = { q: "", direction: "", status: "", method: "", dateFrom: "", dateTo: "" };

// دریافت‌ها — list of CustomerPayments (both RECEIPT and REFUND rows) with
// filters, «ثبت دریافت» to open the record-receipt dialog (build plan §7),
// and «ثبت بازپرداخت» (Sales batch 6 — the refund-creation form deferred
// from Batch 5; the backend POST /receivables/refunds already existed and
// was tested, this just adds the UI).
export default function ReceiptsPage() {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("receivables.view") ?? false;
  const canManage = user?.permissions.includes("receivables.manage") ?? false;

  const [payments, setPayments] = useState<CustomerPaymentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const lastQueryRef = useRef(filters.q);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.direction) params.set("direction", filters.direction);
        if (filters.status) params.set("status", filters.status);
        if (filters.method) params.set("method", filters.method);
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<CustomerPaymentListItem>>(`/receivables/payments?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setPayments(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست دریافت‌ها ناموفق بود.");
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

  if (!canView) return <NoAccess message="اجازه مشاهده دریافت‌ها را ندارید." />;

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">دریافت‌ها</h1>
            <p className="mt-1 text-sm text-muted-foreground">ثبت و پیگیری دریافت‌های نقدی از مشتریان و تخصیص آن‌ها به فاکتورهای فروش</p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setRefundDialogOpen(true)}>
                ثبت بازپرداخت
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                ثبت دریافت
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
                <span className="sr-only">جستجوی دریافت/پرداخت</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره، شماره مرجع یا مشتری"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-direction" className={toolbarFieldLabel}>نوع</Label>
              <select id="filter-direction" className={toolbarSelectClass} value={filters.direction} onChange={(event) => updateFilter("direction", event.target.value as FilterState["direction"])}>
                <option value="">همه</option>
                {CUSTOMER_PAYMENT_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>{customerPaymentDirectionLabels[direction]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
              <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
                <option value="">همه</option>
                {CUSTOMER_PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{customerPaymentStatusLabels[status]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-method" className={toolbarFieldLabel}>روش پرداخت</Label>
              <select id="filter-method" className={toolbarSelectClass} value={filters.method} onChange={(event) => updateFilter("method", event.target.value as FilterState["method"])}>
                <option value="">همه</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>{paymentMethodLabels[method]}</option>
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
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setFilters(emptyFilters); setPage(1); }}>
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {loadError && payments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <p className="text-sm text-destructive" role="alert">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
            </div>
          ) : loading && payments.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : payments.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">{hasActiveFilters ? "دریافت/پرداختی با این مشخصات یافت نشد." : "هنوز دریافتی ثبت نشده است."}</p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">شماره</th>
                    <th className="px-3 py-2.5 font-medium">نوع</th>
                    <th className="px-3 py-2.5 font-medium">تاریخ</th>
                    <th className="px-3 py-2.5 font-medium">مشتری</th>
                    <th className="px-3 py-2.5 font-medium">روش پرداخت</th>
                    <th className="px-3 py-2.5 font-medium">مبلغ (ریال)</th>
                    <th className="px-3 py-2.5 font-medium">وضعیت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/receipts/${payment.id}`)}>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{customerPaymentTitle(payment)}</td>
                      <td className="px-3 py-2.5"><StatusBadge label={customerPaymentDirectionLabels[payment.direction]} tone={customerPaymentDirectionTone[payment.direction]} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(payment.paymentDate)}</td>
                      <td className="px-3 py-2.5">
                        <bdi>{payment.customer.name}</bdi> <bdi className="font-mono text-[11px] text-muted-foreground">{payment.customer.customerNumber}</bdi>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {paymentMethodLabels[payment.method]}
                        {payment.method === "CHECK" && payment.chequeDueDate ? <span className="ms-1 text-xs">(سررسید {formatJalali(payment.chequeDueDate)})</span> : null}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{formatMoney(payment.amount)}</td>
                      <td className="px-3 py-2.5"><StatusBadge label={customerPaymentStatusLabels[payment.status]} tone={customerPaymentStatusTone[payment.status]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {payments.length > 0 ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>

      <RecordReceiptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(paymentId) => {
          setReloadKey((current) => current + 1);
          router.push(`/receipts/${paymentId}`);
        }}
        toasts={{ pushError, pushErrors, pushSuccess }}
      />
      <RecordRefundDialog
        open={refundDialogOpen}
        onOpenChange={setRefundDialogOpen}
        onCreated={(paymentId) => {
          setReloadKey((current) => current + 1);
          router.push(`/receipts/${paymentId}`);
        }}
        toasts={{ pushError, pushErrors, pushSuccess }}
      />
    </div>
  );
}
