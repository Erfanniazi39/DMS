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
  INBOUND_DOCUMENT_STATUSES,
  NoAccess,
  employeeLabel,
  productionOutputTitle,
  stockDocumentStatusLabels,
  stockDocumentStatusTone,
  type ProductionOutputListItem,
  type StockDocumentStatus,
} from "../shared";
import { SortHeader, useTableSort } from "@/components/ui/sortable";
import { sortQuery } from "@/lib/table-sort";
import { HasPermission } from "@/components/has-permission";

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Filters = { q: string; status: "" | StockDocumentStatus };
const emptyFilters: Filters = { q: "", status: "" };

// Production outputs (رسید تولید, Inventory batch I5) — the primary
// finished-goods inbound. Same layout as receipts/page.tsx. Reading needs
// inventory.view; create / draft edit+delete need inventory.receive (shared
// with goods receipts — business-owner decision 2026-10-11).
export default function ProductionOutputsPage() {
  const router = useRouter();
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canReceive = user?.permissions.includes("inventory.receive") ?? false;

  const [rows, setRows] = useState<ProductionOutputListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  // Server-side column sorting (?sortBy=&sortDir=); a change returns to page 1.
  const { sort, onSort } = useTableSort(null, () => setPage(1));
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
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<ProductionOutputListItem>>(`/inventory/production-outputs?${params.toString()}${sortQuery(sort)}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError((reason as ApiError).message ?? "دریافت فهرست رسیدهای تولید ناموفق بود.");
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
  }, [filters, page, reloadKey, canView, sort]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function deleteDraft(event: MouseEvent, row: ProductionOutputListItem) {
    event.stopPropagation();
    if (!window.confirm(`آیا از حذف «${productionOutputTitle(row)}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/inventory/production-outputs/${row.id}`, { method: "DELETE" });
      pushSuccess("پیش‌نویس رسید تولید حذف شد.");
      setReloadKey((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف رسید تولید ناموفق بود.");
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده رسیدهای تولید را ندارید." />;

  const hasFilters = Object.values(filters).some((value) => value !== "");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">رسیدهای تولید</h1>
            <p className="mt-1 text-sm text-muted-foreground">ورود محصول نهایی تولیدشده به انبار — اثر بر موجودی فقط پس از «ثبت نهایی»</p>
          </div>
          {canReceive ? (
            <Button onClick={() => router.push("/inventory/production/new")}>
              <Plus className="size-4" aria-hidden="true" />
              رسید تولید جدید
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-60 items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی رسید تولید</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره رسید یا یادداشت"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
              <select id="filter-status" className={toolbarSelectClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as Filters["status"])}>
                <option value="">همه</option>
                {INBOUND_DOCUMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{stockDocumentStatusLabels[status]}</option>
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
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری رسیدهای تولید...</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">{hasFilters ? "رسید تولیدی با این مشخصات یافت نشد." : "هنوز رسید تولیدی ثبت نشده است."}</p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              {error ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p> : null}
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <SortHeader label="شماره رسید" sortKey="outputNumber" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="تاریخ تولید" sortKey="productionDate" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="تولیدکننده" sortKey="producedBy" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <th className="px-3 py-2.5 font-medium">ردیف</th>
                    <SortHeader label="انبار" sortKey="location" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="یادداشت" sortKey="note" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="ثبت‌کننده" sortKey="createdBy" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="وضعیت" sortKey="status" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    {canReceive ? <th className="px-3 py-2.5 font-medium">عملیات</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/inventory/production/${row.id}`)}>
                      <td className={`px-3 py-2 text-xs ${row.outputNumber ? "font-mono" : "text-muted-foreground"}`}>{productionOutputTitle(row)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(row.productionDate)}</td>
                      <td className="px-3 py-2">{row.producedByEmployee ? employeeLabel(row.producedByEmployee) : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row._count.items.toLocaleString("fa-IR")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground" title={row.note ?? undefined}>{row.note || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.createdByUser?.username ?? "-"}</td>
                      <td className={`px-3 py-2 ${toneCellClasses[stockDocumentStatusTone[row.status]]}`}>
                        <StatusBadge label={stockDocumentStatusLabels[row.status]} tone={stockDocumentStatusTone[row.status]} />
                      </td>
                      {canReceive ? (
                        <td className="px-3 py-2">
                          {row.status === "DRAFT" ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  router.push(`/inventory/production/${row.id}/edit`);
                                }}
                              >
                                ویرایش
                              </Button>
                              <HasPermission code="inventory.delete">
                              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={(event) => void deleteDraft(event, row)}>
                                حذف
                              </Button>
                              </HasPermission>
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
