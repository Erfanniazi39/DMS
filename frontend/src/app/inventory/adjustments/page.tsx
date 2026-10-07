"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge, toneCellClasses } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  STOCK_ADJUSTMENT_KINDS,
  STOCK_DOCUMENT_STATUSES,
  adjustmentTitle,
  stockAdjustmentKindLabels,
  stockAdjustmentKindTone,
  stockDocumentStatusLabels,
  stockDocumentStatusTone,
  type StockAdjustmentKind,
  type StockAdjustmentListItem,
  type StockDocumentStatus,
} from "../shared";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Filters = { q: string; status: "" | StockDocumentStatus; kind: "" | StockAdjustmentKind };
const emptyFilters: Filters = { q: "", status: "", kind: "" };

// Stock adjustment documents (اسناد موجودی) — drafts and posted documents
// together. Only drafts can be edited/deleted (inventory.adjust); posting
// happens on the detail page.
export default function StockAdjustmentsPage() {
  const router = useRouter();
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canAdjust = user?.permissions.includes("inventory.adjust") ?? false;

  const [rows, setRows] = useState<StockAdjustmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
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
        if (filters.kind) params.set("kind", filters.kind);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<StockAdjustmentListItem>>(`/inventory/stock-adjustments?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError((reason as ApiError).message ?? "دریافت فهرست اسناد موجودی ناموفق بود.");
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

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function deleteDraft(event: MouseEvent, row: StockAdjustmentListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف «${adjustmentTitle(row)}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/inventory/stock-adjustments/${row.id}`, { method: "DELETE" });
      pushSuccess("پیش‌نویس سند حذف شد.");
      setReloadKey((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سند ناموفق بود.");
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده اسناد موجودی را ندارید." />;

  const hasFilters = Object.values(filters).some((value) => value !== "");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">اسناد اصلاح موجودی</h1>
            <p className="mt-1 text-sm text-muted-foreground">موجودی اول دوره، رسید موجودی و اصلاح موجودی — اثر بر موجودی فقط پس از «ثبت نهایی»</p>
          </div>
          {canAdjust ? (
            <Button onClick={() => router.push("/inventory/adjustments/new")}>
              <Plus className="size-4" aria-hidden="true" />
              سند جدید
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-60 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی سند</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره سند یا علت"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
              <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as Filters["status"])}>
                <option value="">همه</option>
                {STOCK_DOCUMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{stockDocumentStatusLabels[status]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-kind" className={toolbarFieldLabel}>نوع سند</Label>
              <select id="filter-kind" className={toolbarSelectClass} value={filters.kind} onChange={(event) => updateFilter("kind", event.target.value as Filters["kind"])}>
                <option value="">همه</option>
                {STOCK_ADJUSTMENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{stockAdjustmentKindLabels[kind]}</option>
                ))}
              </select>
            </div>
            {hasFilters ? (
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setFilters(emptyFilters); setPage(1); }}>
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {error && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
              <p className="text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)}>
                تلاش دوباره
              </Button>
            </div>
          ) : loading && rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری اسناد...</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">{hasFilters ? "سندی با این مشخصات یافت نشد." : "هنوز سند موجودی‌ای ثبت نشده است."}</p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              {error ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p> : null}
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">شماره سند</th>
                    <th className="px-3 py-2.5 font-medium">تاریخ سند</th>
                    <th className="px-3 py-2.5 font-medium">نوع سند</th>
                    <th className="px-3 py-2.5 font-medium">علت</th>
                    <th className="px-3 py-2.5 font-medium">ردیف</th>
                    <th className="px-3 py-2.5 font-medium">انبار</th>
                    <th className="px-3 py-2.5 font-medium">ثبت‌کننده</th>
                    <th className="px-3 py-2.5 font-medium">وضعیت</th>
                    {canAdjust ? <th className="px-3 py-2.5 font-medium">عملیات</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/inventory/adjustments/${row.id}`)}>
                      <td className={`px-3 py-2 text-xs ${row.adjustmentNumber ? "font-mono" : "text-muted-foreground"}`}>{adjustmentTitle(row)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(row.adjustmentDate)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge label={stockAdjustmentKindLabels[row.kind]} tone={stockAdjustmentKindTone[row.kind]} />
                      </td>
                      <td className="max-w-72 truncate px-3 py-2" title={row.reason}>{row.reason}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row._count.items.toLocaleString("fa-IR")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.createdByUser?.username ?? "-"}</td>
                      <td className={`px-3 py-2 ${toneCellClasses[stockDocumentStatusTone[row.status]]}`}>
                        <StatusBadge label={stockDocumentStatusLabels[row.status]} tone={stockDocumentStatusTone[row.status]} />
                      </td>
                      {canAdjust ? (
                        <td className="px-3 py-2">
                          {row.status === "DRAFT" ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  router.push(`/inventory/adjustments/${row.id}/edit`);
                                }}
                              >
                                ویرایش
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(event) => void deleteDraft(event, row)}>
                                حذف
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
