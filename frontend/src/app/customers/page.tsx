"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  CUSTOMER_KINDS,
  CUSTOMER_STATUSES,
  StatusBadge,
  customerKindLabels,
  customerStatusLabels,
  customerStatusTone,
  type CustomerKind,
  type CustomerListItem,
  type CustomerStatus,
  type ReferenceOption,
} from "./shared";

// Search-first customer list. One search box covers number, name, legal
// name, legacy code, phone, national id and contact names — normalized
// server-side (Arabic ي/ك, ZWNJ, Persian digits; see backend
// customer-normalize.ts). ARCHIVED customers are hidden unless the status
// filter asks for them (backend default).

const toolbarFieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const toolbarSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterState = {
  q: string;
  // "" = everything except archived (backend default); "ALL" = archived too.
  status: "" | "ALL" | CustomerStatus;
  customerGroupId: string;
  territoryId: string;
  customerKind: "" | CustomerKind;
};

const emptyFilters: FilterState = { q: "", status: "", customerGroupId: "", territoryId: "", customerKind: "" };

export default function CustomersPage() {
  const router = useRouter();
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("customers.view") ?? false;
  const canManage = user?.permissions.includes("customers.manage") ?? false;

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const lastQueryRef = useRef(filters.q);

  const [groups, setGroups] = useState<ReferenceOption[]>([]);
  const [territories, setTerritories] = useState<ReferenceOption[]>([]);

  useEffect(() => {
    if (!canView) return;
    async function loadFilterOptions() {
      try {
        // /all so a customer still filed under a since-deactivated group can be found.
        const [groupsData, territoriesData] = await Promise.all([
          apiFetch<ReferenceOption[]>("/customer-groups/all"),
          apiFetch<ReferenceOption[]>("/territories/all"),
        ]);
        setGroups(groupsData);
        setTerritories(territoriesData);
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات فیلترها ناموفق بود.");
      }
    }
    void loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function loadCustomers() {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.status) params.set("status", filters.status);
        if (filters.customerGroupId) params.set("customerGroupId", filters.customerGroupId);
        if (filters.territoryId) params.set("territoryId", filters.territoryId);
        if (filters.customerKind) params.set("customerKind", filters.customerKind);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<CustomerListItem>>(`/customers?${params.toString()}`);
        if (cancelled) return;
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setCustomers(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت فهرست مشتریان ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const queryChanged = filters.q !== lastQueryRef.current;
    lastQueryRef.current = filters.q;
    const timeout = setTimeout(() => void loadCustomers(), queryChanged && filters.q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [filters, page, reloadKey, canView]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setPage(1);
  }

  const hasActiveFilters = Object.values(filters).some((value) => value !== "");

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
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
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">مشتریان</h1>
            <p className="mt-1 text-sm text-muted-foreground">جستجو و مدیریت اطلاعات پایه مشتریان</p>
          </div>
          {canManage ? (
            <Button onClick={() => router.push("/customers/new")}>
              <Plus className="size-4" aria-hidden="true" />
              مشتری جدید
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={toolbarFieldLabel}>جستجو</span>
              <label className="flex h-8 w-80 max-w-full items-center overflow-hidden rounded-md border border-input bg-background">
                <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی مشتری</span>
                <input
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="شماره، نام، تلفن، شناسه ملی، کد قدیمی یا نام مخاطب"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-status" className={toolbarFieldLabel}>وضعیت</Label>
              <select
                id="filter-status"
                className={toolbarSelectClass}
                value={filters.status}
                onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}
              >
                <option value="">همه (بدون بایگانی‌شده)</option>
                {CUSTOMER_STATUSES.map((status) => (
                  <option key={status} value={status}>{customerStatusLabels[status]}</option>
                ))}
                <option value="ALL">همه (با بایگانی‌شده)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-group" className={toolbarFieldLabel}>گروه مشتری</Label>
              <select
                id="filter-group"
                className={toolbarSelectClass}
                value={filters.customerGroupId}
                onChange={(event) => updateFilter("customerGroupId", event.target.value)}
              >
                <option value="">همه</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.nameFa}{group.isActive ? "" : " (غیرفعال)"}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-territory" className={toolbarFieldLabel}>منطقه فروش</Label>
              <select
                id="filter-territory"
                className={toolbarSelectClass}
                value={filters.territoryId}
                onChange={(event) => updateFilter("territoryId", event.target.value)}
              >
                <option value="">همه</option>
                {territories.map((territory) => (
                  <option key={territory.id} value={territory.id}>{territory.nameFa}{territory.isActive ? "" : " (غیرفعال)"}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-kind" className={toolbarFieldLabel}>نوع شخص</Label>
              <select
                id="filter-kind"
                className={toolbarSelectClass}
                value={filters.customerKind}
                onChange={(event) => updateFilter("customerKind", event.target.value as FilterState["customerKind"])}
              >
                <option value="">همه</option>
                {CUSTOMER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{customerKindLabels[kind]}</option>
                ))}
              </select>
            </div>

            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="size-3.5" aria-hidden="true" />
                پاک کردن فیلترها
              </Button>
            ) : null}
          </div>

          {loadError ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-destructive" role="alert">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)}>
                تلاش مجدد
              </Button>
            </div>
          ) : loading && customers.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری مشتریان...</p>
          ) : customers.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {hasActiveFilters ? "مشتری‌ای با این مشخصات یافت نشد." : "هنوز مشتری‌ای ثبت نشده است."}
            </p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2.5 font-medium"><span className="sr-only">هشدار</span></th>
                    <th className="px-3 py-2.5 font-medium">شماره مشتری</th>
                    <th className="px-3 py-2.5 font-medium">نام</th>
                    <th className="px-3 py-2.5 font-medium">گروه</th>
                    <th className="px-3 py-2.5 font-medium">وضعیت</th>
                    <th className="px-3 py-2.5 font-medium">تلفن</th>
                    <th className="px-3 py-2.5 font-medium">شهر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {customers.map((customer) => {
                    const warnings = [
                      customer.hasPinnedWarning ? "یادداشت هشدار سنجاق‌شده" : null,
                      customer.creditHold ? "توقف اعتباری" : null,
                    ].filter(Boolean);
                    return (
                      <tr
                        key={customer.id}
                        tabIndex={0}
                        className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                        onClick={() => router.push(`/customers/${customer.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") router.push(`/customers/${customer.id}`);
                        }}
                      >
                        <td className="px-2 py-2.5">
                          {warnings.length > 0 ? (
                            <span title={warnings.join("، ")} className="inline-flex">
                              <AlertTriangle className="size-4 text-destructive" aria-label={warnings.join("، ")} />
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground">{customer.customerNumber}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-medium">{customer.name}</span>
                          <span className="ms-2 text-xs text-muted-foreground">{customerKindLabels[customer.customerKind]}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{customer.customerGroup.nameFa}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={customerStatusLabels[customer.status]} tone={customerStatusTone[customer.status]} />
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground tabular-nums" dir="ltr">
                          <span className="block text-right">{customer.phone}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{customer.defaultCity ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {customers.length > 0 && !loadError ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
