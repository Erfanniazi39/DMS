"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { formatExpiry, formatTenure } from "./tenure";
import { PAGE_SIZE, sortFieldLabels, statusLabels, type Employee, type EmployeeStatus, type PageToken, type SortDirection, type SortField } from "./shared";

// «فهرست کارکنان»: search + sort controls, the table and the page-number
// footer. All state — query, sort, page — and the filter/sort/paging
// computation (including buildPageNumbers) live in page.tsx and are passed in.
// A row opens the employee's own page (/employees/:id) — details, contracts
// and editing live there, not in the list.
const statusTone: Record<EmployeeStatus, BadgeTone> = { active: "success", on_leave: "warning", terminated: "destructive" };

export function EmployeeListSection({
  employees,
  sortedEmployees,
  pagedEmployees,
  loading,
  query,
  setQuery,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
  page,
  setPage,
  totalPages,
  pageNumbers,
}: {
  employees: Employee[];
  sortedEmployees: Employee[];
  pagedEmployees: Employee[];
  loading: boolean;
  query: string;
  setQuery: (query: string) => void;
  sortField: SortField;
  setSortField: (field: SortField) => void;
  sortDirection: SortDirection;
  setSortDirection: Dispatch<SetStateAction<SortDirection>>;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  pageNumbers: PageToken[];
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">فهرست کارکنان</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
            <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">جستجوی کارمند</span>
            <input
              className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
              placeholder="جستجو بر اساس نام، کد، کد ملی یا شماره تماس"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <Label htmlFor="employee-sort-field" className="shrink-0 text-xs text-muted-foreground">مرتب‌سازی بر اساس</Label>
            <select
              id="employee-sort-field"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={sortField}
              onChange={(event) => {
                setSortField(event.target.value as SortField);
                setPage(1);
              }}
            >
              {Object.entries(sortFieldLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
            >
              {sortDirection === "asc" ? "صعودی" : "نزولی"}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری کارکنان...</p>
        ) : sortedEmployees.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            {employees.length === 0 ? "هنوز کارمندی ثبت نشده است." : "کارمندی با این مشخصات یافت نشد."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[60rem] text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">تصویر</th>
                  <th className="px-4 py-3 font-medium">کد</th>
                  <th className="px-4 py-3 font-medium">نام</th>
                  <th className="px-4 py-3 font-medium">واحد</th>
                  <th className="px-4 py-3 font-medium">سمت</th>
                  <th className="px-4 py-3 font-medium">وضعیت</th>
                  <th className="px-4 py-3 font-medium">سابقه کار</th>
                  <th className="px-4 py-3 font-medium">قرارداد فعلی</th>
                  <th className="px-4 py-3 font-medium">جزئیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedEmployees.map((employee) => (
                  <tr key={employee.id} className={employee.status === "terminated" ? "text-muted-foreground hover:bg-muted/30" : "hover:bg-muted/30"}>
                    <td className="px-4 py-3">
                      <div className="flex size-14 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                        {employee.photoPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api${employee.photoPath}`} alt="" className="size-full object-cover" />
                        ) : (
                          <User className="size-6 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">{employee.code}</td>
                    <td className="px-4 py-3">
                      <Link href={`/employees/${employee.id}`} className="text-primary hover:underline">{employee.firstName} {employee.lastName}</Link>
                    </td>
                    <td className="px-4 py-3">{employee.department.name}</td>
                    <td className="px-4 py-3">{employee.position || "-"}</td>
                    <td className="px-4 py-3"><StatusBadge label={statusLabels[employee.status]} tone={statusTone[employee.status]} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatTenure(employee.tenure)}</td>
                    <td className="px-4 py-3 text-xs">
                      {employee.status === "terminated" ? (
                        "-"
                      ) : employee.currentContract ? (
                        employee.contractExpired ? (
                          <StatusBadge label="منقضی‌شده" tone="destructive" />
                        ) : employee.daysToExpiry !== null && employee.daysToExpiry <= 30 ? (
                          <StatusBadge label={formatExpiry(employee.daysToExpiry)} tone="warning" />
                        ) : (
                          <span className="text-muted-foreground">{formatExpiry(employee.daysToExpiry)}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">ثبت نشده</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/employees/${employee.id}`} className="text-sm text-primary hover:underline">مشاهده</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && sortedEmployees.length > 0 && totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              نمایش {(page - 1) * PAGE_SIZE + 1} تا {Math.min(page * PAGE_SIZE, sortedEmployees.length)} از {sortedEmployees.length} کارمند
            </p>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                قبلی
              </Button>
              {pageNumbers.map((pageToken) =>
                typeof pageToken === "number" ? (
                  <Button
                    key={pageToken}
                    type="button"
                    variant={pageToken === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(pageToken)}
                  >
                    {pageToken}
                  </Button>
                ) : (
                  <span key={pageToken} className="px-1 text-xs text-muted-foreground">…</span>
                ),
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                بعدی
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
