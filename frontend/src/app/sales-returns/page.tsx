"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { deliveryTitle } from "../deliveries/shared";
import {
  NoAccess,
  returnReasonLabels,
  salesReturnStatusLabels,
  salesReturnStatusTone,
  salesReturnTitle,
  SALES_RETURN_STATUSES,
  type SalesReturnListItem,
  type SalesReturnStatus,
} from "./shared";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Tab = "queue" | "list";

type FilterState = { q: string; status: "" | SalesReturnStatus; dateFrom: string; dateTo: string };
const emptyFilters: FilterState = { q: "", status: "", dateFrom: "", dateTo: "" };

function ReturnsTable({ rows, loading }: { rows: SalesReturnListItem[]; loading: boolean }) {
  const router = useRouter();
  return (
    <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
      <table className="w-full text-right text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">شماره مرجوعی</th>
            <th className="px-3 py-2.5 font-medium">تاریخ درخواست</th>
            <th className="px-3 py-2.5 font-medium">حواله</th>
            <th className="px-3 py-2.5 font-medium">مشتری</th>
            <th className="px-3 py-2.5 font-medium">علت</th>
            <th className="px-3 py-2.5 font-medium">ردیف</th>
            <th className="px-3 py-2.5 font-medium">وضعیت</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/sales-returns/${row.id}`)}>
              <td className={`px-3 py-2.5 whitespace-nowrap ${row.returnNumber ? "font-mono text-xs" : "text-xs text-muted-foreground"}`}>{salesReturnTitle(row)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatJalali(row.requestDate)}</td>
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{row.delivery ? deliveryTitle(row.delivery) : "-"}</td>
              <td className="px-3 py-2.5">
                <bdi className="font-mono text-[11px] text-muted-foreground">{row.customer.customerNumber}</bdi>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{returnReasonLabels[row.reason]}</td>
              <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row._count.items.toLocaleString("fa-IR")}</td>
              <td className="px-3 py-2.5">
                <StatusBadge label={salesReturnStatusLabels[row.status]} tone={salesReturnStatusTone[row.status]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// «در انتظار تأیید» — GET /sales-returns?status=REQUESTED (sales.view): the
// approval queue (build plan's "approval queue section").
function QueueTab() {
  const [rows, setRows] = useState<SalesReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalesReturnListItem[]>("/sales-returns?status=REQUESTED")
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت صف تأیید مرجوعی ناموفق بود.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <>
      <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">مرجوعی‌های در انتظار تأیید یا ردِّ مدیر فروش.</div>
      {loadError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">مرجوعی در انتظار تأیید وجود ندارد.</p>
      ) : (
        <ReturnsTable rows={rows} loading={loading} />
      )}
    </>
  );
}

// «همهٔ مرجوعی‌ها» — GET /sales-returns (sales.view), server-side pagination
// and filters.
function ListTab() {
  const [rows, setRows] = useState<SalesReturnListItem[]>([]);
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
        const data = await apiFetch<Paginated<SalesReturnListItem>>(`/sales-returns?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setLoadError(null);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست مرجوعی‌ها ناموفق بود.");
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

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className={toolbarFieldLabel}>جستجو</span>
          <label className="flex h-8 w-64 items-center overflow-hidden rounded-md border border-input bg-background">
            <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">جستجوی مرجوعی</span>
            <input
              className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
              placeholder="شماره مرجوعی، حواله یا مشتری"
              value={filters.q}
              onChange={(event) => updateFilter("q", event.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
          <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
            <option value="">همه</option>
            {SALES_RETURN_STATUSES.map((status) => (
              <option key={status} value={status}>{salesReturnStatusLabels[status]}</option>
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

      {loadError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{hasActiveFilters ? "مرجوعی‌ای با این مشخصات یافت نشد." : "هنوز مرجوعی‌ای ثبت نشده است."}</p>
      ) : (
        <ReturnsTable rows={rows} loading={loading} />
      )}
      {rows.length > 0 ? <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} /> : null}
    </>
  );
}

// مرجوعی‌ها — approval queue + list (build plan). «ثبت مرجوعی» is always
// started from a POSTED delivery's own detail page (same convention as
// Deliveries/Invoices — see deliveries/[id]/_sections/ReturnsSection.tsx),
// not from a stray "+ new" button here.
export default function SalesReturnsPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const [tab, setTab] = useState<Tab>("queue");
  const { toasts, dismiss } = useToasts();

  if (!canView) return <NoAccess message="اجازه مشاهده مرجوعی‌ها را ندارید." />;

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">مرجوعی‌ها</h1>
          <p className="mt-1 text-sm text-muted-foreground">درخواست، تأیید، دریافت و بازرسی مرجوعی کالا از مشتریان</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex gap-1 border-b border-border px-3" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "queue"} className={tabClass(tab === "queue")} onClick={() => setTab("queue")}>
              در انتظار تأیید
            </button>
            <button type="button" role="tab" aria-selected={tab === "list"} className={tabClass(tab === "list")} onClick={() => setTab("list")}>
              همهٔ مرجوعی‌ها
            </button>
          </div>
          {tab === "queue" ? <QueueTab /> : <ListTab />}
        </div>
      </div>
    </div>
  );
}
