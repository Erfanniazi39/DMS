"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge, toneCellClasses } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, salesDeliveryStatusLabels, salesDeliveryStatusTone, salesOrderTitle } from "../sales-orders/shared";
import {
  DELIVERY_STATUSES,
  deliveryStatusLabels,
  deliveryStatusTone,
  deliveryTitle,
  type DeliveryListItem,
  type DeliveryQueueRow,
  type DeliveryStatus,
} from "./shared";

// Same dense toolbar sizing as the Sales Orders / Purchases lists.
const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Tab = "queue" | "list";

type FilterState = { q: string; status: "" | DeliveryStatus; dateFrom: string; dateTo: string };
const emptyFilters: FilterState = { q: "", status: "", dateFrom: "", dateTo: "" };

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

// «صف تحویل» — GET /deliveries/queue (sales.view): confirmed orders with
// lines still to deliver. «ایجاد تحویل» (sales.deliver) opens
// /deliveries/new?orderId=… with the open quantities prefilled.
function QueueTab({ canDeliver }: { canDeliver: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<DeliveryQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
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
        const data = await apiFetch<Paginated<DeliveryQueueRow>>(`/deliveries/queue?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت صف تحویل ناموفق بود.");
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

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <SearchBox
          label="جستجوی سفارش در صف تحویل"
          placeholder="شماره سفارش، مشتری یا شماره مرجع"
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <p className="pb-1.5 text-xs text-muted-foreground">سفارش‌های تأییدشده‌ای که هنوز همهٔ اقلام آن‌ها تحویل نشده است.</p>
      </div>

      {loadError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری صف تحویل...</p>
      ) : rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{q ? "سفارشی با این مشخصات در صف تحویل نیست." : "سفارشی در انتظار تحویل نیست."}</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">شماره سفارش</th>
                <th className="px-3 py-2.5 font-medium">تاریخ سفارش</th>
                <th className="px-3 py-2.5 font-medium">تاریخ تحویل درخواستی</th>
                <th className="px-3 py-2.5 font-medium">مشتری</th>
                <th className="px-3 py-2.5 font-medium">ردیف‌های باز</th>
                <th className="px-3 py-2.5 font-medium">وضعیت تحویل</th>
                <th className="px-3 py-2.5 font-medium">پیش‌نویس حواله</th>
                <th className="px-3 py-2.5 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/sales-orders/${row.id}`)}>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{salesOrderTitle(row)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(row.orderDate)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{row.requestedDeliveryDate ? formatJalali(row.requestedDeliveryDate) : "-"}</td>
                  <td className="px-3 py-2.5">
                    <bdi>{row.customerName}</bdi> <bdi className="font-mono text-[11px] text-muted-foreground">{row.customer.customerNumber}</bdi>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {row.openLineCount.toLocaleString("fa-IR")} <span className="text-xs text-muted-foreground">از {row.lineCount.toLocaleString("fa-IR")}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge label={salesDeliveryStatusLabels[row.deliveryStatus]} tone={salesDeliveryStatusTone[row.deliveryStatus]} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.draftDeliveryCount > 0 ? row.draftDeliveryCount.toLocaleString("fa-IR") : "-"}</td>
                  <td className="px-3 py-2.5">
                    {canDeliver ? (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/deliveries/new?orderId=${row.id}`);
                          }}
                        >
                          <PackagePlus className="size-3.5" aria-hidden="true" />
                          ایجاد تحویل
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

// «حواله‌های تحویل» — GET /deliveries (sales.view), server-side pagination and
// filters. Only a DRAFT can be edited or deleted (sales.deliver); posting
// happens on the detail page.
function ListTab({ canDeliver, pushError, pushSuccess }: { canDeliver: boolean; pushError: (message: string) => void; pushSuccess: (message: string) => void }) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
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
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<DeliveryListItem>>(`/deliveries?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setDeliveries(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست حواله‌های تحویل ناموفق بود.");
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

  async function deleteDraft(event: MouseEvent, delivery: DeliveryListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف «${deliveryTitle(delivery)}» (${delivery.salesOrder.customerName}) مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/deliveries/${delivery.id}`, { method: "DELETE" });
      pushSuccess(`«${deliveryTitle(delivery)}» حذف شد.`);
      setReloadKey((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف حواله ناموفق بود.");
    }
  }

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <SearchBox
          label="جستجوی حواله تحویل"
          placeholder="شماره حواله، شماره سفارش، مشتری یا تحویل‌گیرنده"
          value={filters.q}
          onChange={(value) => updateFilter("q", value)}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
          <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
            <option value="">همه</option>
            {DELIVERY_STATUSES.map((status) => (
              <option key={status} value={status}>{deliveryStatusLabels[status]}</option>
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

      {loadError && deliveries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && deliveries.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری حواله‌ها...</p>
      ) : deliveries.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{hasActiveFilters ? "حواله‌ای با این مشخصات یافت نشد." : "هنوز حواله تحویلی ثبت نشده است."}</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">شماره حواله</th>
                <th className="px-3 py-2.5 font-medium">تاریخ تحویل</th>
                <th className="px-3 py-2.5 font-medium">سفارش</th>
                <th className="px-3 py-2.5 font-medium">مشتری</th>
                <th className="px-3 py-2.5 font-medium">ردیف</th>
                <th className="px-3 py-2.5 font-medium">تحویل‌گیرنده</th>
                <th className="px-3 py-2.5 font-medium">وضعیت</th>
                <th className="px-3 py-2.5 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deliveries.map((delivery) => {
                const editable = canDeliver && delivery.status === "DRAFT";
                return (
                  <tr key={delivery.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/deliveries/${delivery.id}`)}>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${delivery.deliveryNumber ? "font-mono text-xs" : "text-xs text-muted-foreground"}`}>{deliveryTitle(delivery)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(delivery.deliveryDate)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{salesOrderTitle(delivery.salesOrder)}</td>
                    <td className="px-3 py-2.5">
                      <bdi>{delivery.salesOrder.customerName}</bdi> <bdi className="font-mono text-[11px] text-muted-foreground">{delivery.customer.customerNumber}</bdi>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{delivery._count.items.toLocaleString("fa-IR")}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{delivery.receivedByName || "-"}</td>
                    <td className={`px-3 py-2.5 ${toneCellClasses[deliveryStatusTone[delivery.status]]}`}>
                      <StatusBadge label={deliveryStatusLabels[delivery.status]} tone={deliveryStatusTone[delivery.status]} />
                    </td>
                    <td className="px-3 py-2.5">
                      {editable ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`/deliveries/${delivery.id}/edit`);
                            }}
                          >
                            ویرایش
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(event) => void deleteDraft(event, delivery)}>
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
      {deliveries.length > 0 ? (
        <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
      ) : null}
    </>
  );
}

// تحویل‌ها — work queue (confirmed orders with lines still to deliver) +
// list of delivery notes (build plan §7).
export default function DeliveriesPage() {
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canDeliver = user?.permissions.includes("sales.deliver") ?? false;
  const [tab, setTab] = useState<Tab>("queue");

  if (!canView) return <NoAccess message="اجازه مشاهده حواله‌های تحویل را ندارید." />;

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">تحویل‌ها</h1>
          <p className="mt-1 text-sm text-muted-foreground">صدور و ثبت حوالهٔ تحویل کالا برای سفارش‌های فروش تأییدشده</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex gap-1 border-b border-border px-3" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "queue"} className={tabClass(tab === "queue")} onClick={() => setTab("queue")}>
              صف تحویل
            </button>
            <button type="button" role="tab" aria-selected={tab === "list"} className={tabClass(tab === "list")} onClick={() => setTab("list")}>
              حواله‌های تحویل
            </button>
          </div>
          {tab === "queue" ? <QueueTab canDeliver={canDeliver} /> : <ListTab canDeliver={canDeliver} pushError={pushError} pushSuccess={pushSuccess} />}
        </div>
      </div>
    </div>
  );
}
