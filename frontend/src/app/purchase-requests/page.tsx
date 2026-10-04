"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LIST_PAGE_SIZE, ListPagination, totalPages, type Paginated } from "@/components/ui/list-pagination";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { StatusBadge, selectClass, employeeFullName, type DepartmentOption } from "../purchases/shared";
import {
  PURCHASE_REQUEST_PRIORITIES,
  PURCHASE_REQUEST_STATUSES,
  purchaseRequestItemsSummary,
  purchaseRequestPriorityLabels,
  purchaseRequestPriorityTone,
  purchaseRequestStatusLabels,
  purchaseRequestStatusTone,
  type PurchaseRequestListItem,
  type PurchaseRequestPriority,
  type PurchaseRequestStatus,
} from "./shared";

type FilterState = {
  q: string;
  status: "" | PurchaseRequestStatus;
  priority: "" | PurchaseRequestPriority;
  requesterDepartmentId: string;
};

const emptyFilters: FilterState = {
  q: "",
  status: "",
  priority: "",
  requesterDepartmentId: "",
};

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  // Purchase Requests share the purchases.* permissions with Purchases.
  const canView = user?.permissions.includes("purchases.view") ?? false;
  const canCreate = user?.permissions.includes("purchases.manage") ?? false;
  const canEdit = user?.permissions.includes("purchases.edit") ?? false;

  const [requests, setRequests] = useState<PurchaseRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  // Server-side pagination (GET /purchase-requests?page=&pageSize=), same
  // pattern as the Purchases list. Any filter change resets to page 1.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!canView) return;
    async function loadFilterOptions() {
      try {
        setDepartments(await apiFetch<DepartmentOption[]>("/departments"));
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
    async function loadRequests() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.q.trim()) params.set("q", filters.q.trim());
        if (filters.status) params.set("status", filters.status);
        if (filters.priority) params.set("priority", filters.priority);
        if (filters.requesterDepartmentId) params.set("requesterDepartmentId", filters.requesterDepartmentId);
        params.set("page", String(page));
        params.set("pageSize", String(LIST_PAGE_SIZE));
        const data = await apiFetch<Paginated<PurchaseRequestListItem>>(`/purchase-requests?${params.toString()}`);
        if (cancelled) return;
        // Current page fell past the end (e.g. the last row on it moved off
        // after a filter change) — jump to the new last page instead of
        // showing an empty table.
        if (data.items.length === 0 && data.total > 0 && page > 1) {
          setPage(totalPages(data.total, LIST_PAGE_SIZE));
          return;
        }
        setRequests(data.items);
        setTotal(data.total);
      } catch (reason) {
        if (!cancelled) pushError((reason as ApiError).message ?? "دریافت فهرست درخواست‌های خرید ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const timeout = setTimeout(() => void loadRequests(), filters.q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, canView]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به درخواست‌های خرید را ندارید.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">درخواست‌های خرید</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              درخواست خرید مرحله‌ای اختیاری پیش از ثبت خرید است — بیشتر خریدهای فوری یا مستقیم بدون آن ثبت می‌شوند.
            </p>
          </div>
          {canCreate ? (
            <Button onClick={() => router.push("/purchase-requests/new")}>
              <Plus className="size-4" aria-hidden="true" />
              ثبت درخواست خرید
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست درخواست‌های خرید</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-72">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی درخواست خرید</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس شماره درخواست"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </label>

              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-status" className="text-xs text-muted-foreground">وضعیت</Label>
                <select
                  id="filter-status"
                  className={selectClass}
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}
                >
                  <option value="">همه</option>
                  {PURCHASE_REQUEST_STATUSES.map((status) => (
                    <option key={status} value={status}>{purchaseRequestStatusLabels[status]}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-priority" className="text-xs text-muted-foreground">اولویت</Label>
                <select
                  id="filter-priority"
                  className={selectClass}
                  value={filters.priority}
                  onChange={(event) => updateFilter("priority", event.target.value as FilterState["priority"])}
                >
                  <option value="">همه</option>
                  {PURCHASE_REQUEST_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>{purchaseRequestPriorityLabels[priority]}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-department" className="text-xs text-muted-foreground">دپارتمان درخواست‌کننده</Label>
                <select
                  id="filter-department"
                  className={selectClass}
                  value={filters.requesterDepartmentId}
                  onChange={(event) => updateFilter("requesterDepartmentId", event.target.value)}
                >
                  <option value="">همه</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </div>

              {Object.values(filters).some((value) => value !== "") ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters(emptyFilters);
                    setPage(1);
                  }}
                >
                  پاک کردن فیلترها
                </Button>
              ) : null}
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری درخواست‌ها...</p>
            ) : requests.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                درخواست خریدی با این مشخصات یافت نشد.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">تاریخ درخواست</th>
                      <th className="px-4 py-3 font-medium">شماره درخواست</th>
                      <th className="px-4 py-3 font-medium">دپارتمان درخواست‌کننده</th>
                      <th className="px-4 py-3 font-medium">درخواست‌کننده</th>
                      <th className="px-4 py-3 font-medium">قلم</th>
                      <th className="px-4 py-3 font-medium">اولویت</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      <th className="px-4 py-3 font-medium">خریدهای مرتبط</th>
                      <th className="px-4 py-3 font-medium">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {requests.map((request) => (
                      <tr
                        key={request.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => router.push(`/purchase-requests/${request.id}`)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">{formatJalali(request.requestDate)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{request.requestNumber}</td>
                        <td className="px-4 py-3">{request.requesterDepartment.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {request.requestedByEmployee ? employeeFullName(request.requestedByEmployee) : "-"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{purchaseRequestItemsSummary(request)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge label={purchaseRequestPriorityLabels[request.priority]} tone={purchaseRequestPriorityTone[request.priority]} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge label={purchaseRequestStatusLabels[request.status]} tone={purchaseRequestStatusTone[request.status]} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{request._count.purchases.toLocaleString("fa-IR")}</td>
                        <td className="px-4 py-3">
                          {canEdit ? (
                            <Button
                              variant="link"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/purchase-requests/${request.id}/edit`);
                              }}
                            >
                              ویرایش
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {requests.length > 0 ? (
              <ListPagination page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
