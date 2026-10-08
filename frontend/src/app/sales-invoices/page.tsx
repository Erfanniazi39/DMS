"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus, Search, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { ColorLegend, StatusBadge, toneCellClasses } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, SALES_PAYMENT_STATUSES, salesOrderTitle, salesPaymentStatusLabels, salesPaymentStatusTone, type SalesPaymentStatus } from "../sales-orders/shared";
import { deliveryTitle } from "../deliveries/shared";
import { createInvoiceFromDelivery } from "./create-invoice";
import {
  invoiceOpenAmount,
  isInvoiceOverdue,
  SALES_INVOICE_STATUSES,
  SALES_SOURCE_TYPES,
  salesInvoiceStatusLabels,
  salesInvoiceStatusTone,
  salesInvoiceTitle,
  salesSourceTypeLabels,
  type SalesInvoiceListItem,
  type SalesInvoiceQueueRow,
  type SalesInvoiceStatus,
  type SalesSourceType,
} from "./shared";

// Same dense toolbar sizing as the Deliveries / Sales Orders lists.
const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Tab = "queue" | "list";

type FilterState = {
  q: string;
  status: "" | SalesInvoiceStatus;
  paymentStatus: "" | SalesPaymentStatus;
  sourceType: "" | SalesSourceType;
  overdue: boolean;
  dateFrom: string;
  dateTo: string;
};
const emptyFilters: FilterState = { q: "", status: "", paymentStatus: "", sourceType: "", overdue: false, dateFrom: "", dateTo: "" };

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={toolbarFieldLabel}>جستجو</span>
      <label className="flex h-8 w-64 items-center overflow-hidden rounded-md border border-input bg-background">
        <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

// «صف فاکتور» — GET /sales-invoices/queue (sales.view): posted deliveries not
// yet invoiced. «ایجاد فاکتور» (sales.invoice) creates the DRAFT in one click
// (POST /sales-invoices { deliveryId }) and opens it; a delivery that already
// has a draft opens that draft instead.
function QueueTab({ canInvoice, pushError }: { canInvoice: boolean; pushError: (message: string) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<SalesInvoiceQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [creatingId, setCreatingId] = useState<number | null>(null);
  const lastQueryRef = useRef(q);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<SalesInvoiceQueueRow>>(`/sales-invoices/queue?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت صف فاکتور ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const queryChanged = q !== lastQueryRef.current;
    lastQueryRef.current = q;
    const timeout = setTimeout(() => void load(), queryChanged && q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [q, page, reloadKey]);

  async function create(event: MouseEvent, row: SalesInvoiceQueueRow) {
    event.stopPropagation();
    setCreatingId(row.id);
    try {
      const id = await createInvoiceFromDelivery(row.id);
      router.push(`/sales-invoices/${id}`);
    } catch (reason) {
      const error = reason as ApiError;
      pushError(error.messages?.length ? error.messages.join("، ") : (error.message ?? "ایجاد فاکتور ناموفق بود."));
      setCreatingId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <SearchBox
          label="جستجوی حواله در صف فاکتور"
          placeholder="شماره حواله، شماره سفارش یا مشتری"
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <p className="pb-1.5 text-xs text-muted-foreground">حواله‌های ثبت‌شده‌ای که هنوز فاکتور آن‌ها ثبت نشده است (هر حواله یک فاکتور).</p>
      </div>

      {loadError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری صف فاکتور...</p>
      ) : rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{q ? "حواله‌ای با این مشخصات در صف فاکتور نیست." : "حوالهٔ فاکتورنشده‌ای وجود ندارد."}</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">شماره حواله</th>
                <th className="px-3 py-2.5 font-medium">تاریخ تحویل</th>
                <th className="px-3 py-2.5 font-medium">سفارش</th>
                <th className="px-3 py-2.5 font-medium">مشتری</th>
                <th className="px-3 py-2.5 font-medium">ردیف‌های فاکتورنشده</th>
                <th className="px-3 py-2.5 font-medium">پیش‌نویس فاکتور</th>
                <th className="px-3 py-2.5 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/deliveries/${row.id}`)}>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{deliveryTitle(row)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(row.deliveryDate)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{salesOrderTitle(row.salesOrder)}</td>
                  <td className="px-3 py-2.5">
                    <bdi>{row.salesOrder.customerName}</bdi> <bdi className="font-mono text-[11px] text-muted-foreground">{row.customer.customerNumber}</bdi>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {row.openLineCount.toLocaleString("fa-IR")} <span className="text-xs text-muted-foreground">از {row.lineCount.toLocaleString("fa-IR")}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.draftInvoiceId ? (
                      <Link href={`/sales-invoices/${row.draftInvoiceId}`} className="text-xs text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
                        پیش‌نویس #{row.draftInvoiceId.toLocaleString("fa-IR")}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {canInvoice && !row.draftInvoiceId ? (
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" disabled={creatingId !== null} onClick={(event) => void create(event, row)}>
                          <FilePlus2 className="size-3.5" aria-hidden="true" />
                          {creatingId === row.id ? "در حال ایجاد..." : "ایجاد فاکتور"}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 ? (
        <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
      ) : null}
    </>
  );
}

// «فاکتورها» — GET /sales-invoices (sales.view), server-side pagination and
// filters. Overdue invoices (posted, not fully paid, due date passed) are
// tinted. Only a DRAFT can be deleted (sales.invoice); posting happens on
// the detail page.
function ListTab({ canInvoice, pushError, pushSuccess }: { canInvoice: boolean; pushError: (message: string) => void; pushSuccess: (message: string) => void }) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<SalesInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(filters.q);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.status) params.set("status", filters.status);
        if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
        if (filters.sourceType) params.set("sourceType", filters.sourceType);
        if (filters.overdue) params.set("overdue", "true");
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<SalesInvoiceListItem>>(`/sales-invoices?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setInvoices(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست فاکتورها ناموفق بود.");
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
  }, [filters, page, reloadKey]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function deleteDraft(event: MouseEvent, invoice: SalesInvoiceListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف «${salesInvoiceTitle(invoice)}» (${invoice.customerName}) مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/sales-invoices/${invoice.id}`, { method: "DELETE" });
      pushSuccess(`«${salesInvoiceTitle(invoice)}» حذف شد.`);
      setReloadKey((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف فاکتور ناموفق بود.");
    }
  }

  const hasActiveFilters = Object.entries(filters).some(([, value]) => value !== "" && value !== false);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <SearchBox label="جستجوی فاکتور فروش" placeholder="شماره فاکتور، شماره سفارش یا مشتری" value={filters.q} onChange={(value) => updateFilter("q", value)} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
          <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
            <option value="">همه</option>
            {SALES_INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>{salesInvoiceStatusLabels[status]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-payment" className={toolbarFieldLabel}>وضعیت پرداخت</Label>
          <select id="filter-payment" className={toolbarSelectClass} value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as FilterState["paymentStatus"])}>
            <option value="">همه</option>
            {SALES_PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>{salesPaymentStatusLabels[status]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-source" className={toolbarFieldLabel}>نوع</Label>
          <select id="filter-source" className={toolbarSelectClass} value={filters.sourceType} onChange={(event) => updateFilter("sourceType", event.target.value as FilterState["sourceType"])}>
            <option value="">همه</option>
            {SALES_SOURCE_TYPES.map((source) => (
              <option key={source} value={source}>{salesSourceTypeLabels[source]}</option>
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
        <label className="flex h-8 items-center gap-1.5 text-xs">
          <input type="checkbox" checked={filters.overdue} onChange={(event) => updateFilter("overdue", event.target.checked)} />
          فقط سررسید گذشته
        </label>
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

      {loadError && invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && invoices.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری فاکتورها...</p>
      ) : invoices.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{hasActiveFilters ? "فاکتوری با این مشخصات یافت نشد." : "هنوز فاکتور فروشی ثبت نشده است."}</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">شماره فاکتور</th>
                <th className="px-3 py-2.5 font-medium">تاریخ</th>
                <th className="px-3 py-2.5 font-medium">سررسید</th>
                <th className="px-3 py-2.5 font-medium">مشتری</th>
                <th className="px-3 py-2.5 font-medium">سفارش</th>
                <th className="px-3 py-2.5 font-medium">مبلغ کل (ریال)</th>
                <th className="px-3 py-2.5 font-medium">مانده (ریال)</th>
                <th className="px-3 py-2.5 font-medium">پرداخت</th>
                <th className="px-3 py-2.5 font-medium">وضعیت</th>
                <th className="px-3 py-2.5 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map((invoice) => {
                const overdue = isInvoiceOverdue(invoice);
                const posted = invoice.status === "POSTED";
                return (
                  <tr key={invoice.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/sales-invoices/${invoice.id}`)}>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${invoice.invoiceNumber ? "font-mono text-xs" : "text-xs text-muted-foreground"}`}>
                      {salesInvoiceTitle(invoice)}
                      {invoice.sourceType === "OPENING_BALANCE" ? (
                        <span className="ms-1.5">
                          <StatusBadge label={salesSourceTypeLabels.OPENING_BALANCE} tone="accent" />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(invoice.invoiceDate)}</td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${overdue ? `${toneCellClasses.destructive} font-medium text-destructive` : "text-muted-foreground"}`}>
                      {invoice.dueDate ? formatJalali(invoice.dueDate) : "-"}
                    </td>
                    <td className="px-3 py-2.5">
                      <bdi>{invoice.customerName}</bdi> <bdi className="font-mono text-[11px] text-muted-foreground">{invoice.customer.customerNumber}</bdi>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{invoice.salesOrder ? salesOrderTitle(invoice.salesOrder) : "-"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatMoney(invoice.totalAmount)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{posted ? formatMoney(invoiceOpenAmount(invoice)) : "-"}</td>
                    <td className={`px-3 py-2.5 ${posted ? toneCellClasses[overdue ? "destructive" : salesPaymentStatusTone[invoice.paymentStatus]] : ""}`}>
                      {posted ? (
                        <StatusBadge label={overdue ? `${salesPaymentStatusLabels[invoice.paymentStatus]} — سررسید گذشته` : salesPaymentStatusLabels[invoice.paymentStatus]} tone={overdue ? "destructive" : salesPaymentStatusTone[invoice.paymentStatus]} />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge label={salesInvoiceStatusLabels[invoice.status]} tone={salesInvoiceStatusTone[invoice.status]} />
                    </td>
                    <td className="px-3 py-2.5">
                      {canInvoice && invoice.status === "DRAFT" ? (
                        <div className="flex justify-end">
                          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(event) => void deleteDraft(event, invoice)}>
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
      {invoices.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <ColorLegend
            title="وضعیت پرداخت"
            items={[
              { label: salesPaymentStatusLabels.UNPAID, tone: salesPaymentStatusTone.UNPAID },
              { label: salesPaymentStatusLabels.PARTIALLY_PAID, tone: salesPaymentStatusTone.PARTIALLY_PAID },
              { label: salesPaymentStatusLabels.PAID, tone: salesPaymentStatusTone.PAID },
              { label: "سررسید گذشته", tone: "destructive" },
            ]}
          />
          <ListPagination page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
        </div>
      ) : null}
    </>
  );
}

// فاکتورهای فروش — work queue (posted deliveries not yet invoiced) + list of
// invoices with overdue tint (build plan §7).
export default function SalesInvoicesPage() {
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canInvoice = user?.permissions.includes("sales.invoice") ?? false;
  const [tab, setTab] = useState<Tab>("queue");

  if (!canView) return <NoAccess message="اجازه مشاهده فاکتورهای فروش را ندارید." />;

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">فاکتورهای فروش</h1>
            <p className="mt-1 text-sm text-muted-foreground">صدور و ثبت فاکتور برای حواله‌های تحویل ثبت‌شده</p>
          </div>
          {canInvoice ? (
            <Link href="/sales-invoices/opening-balance" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Plus className="size-3.5" aria-hidden="true" />
              فاکتور مانده افتتاحیه
            </Link>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex gap-1 border-b border-border px-3" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "queue"} className={tabClass(tab === "queue")} onClick={() => setTab("queue")}>
              صف فاکتور
            </button>
            <button type="button" role="tab" aria-selected={tab === "list"} className={tabClass(tab === "list")} onClick={() => setTab("list")}>
              فاکتورها
            </button>
          </div>
          {tab === "queue" ? <QueueTab canInvoice={canInvoice} pushError={pushError} /> : <ListTab canInvoice={canInvoice} pushError={pushError} pushSuccess={pushSuccess} />}
        </div>
      </div>
    </div>
  );
}
