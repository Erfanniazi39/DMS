"use client";

import { Fragment, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronUp, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmployeeDetailRow } from "./EmployeeDetailRow";
import { PAGE_SIZE, sortFieldLabels, statusLabels, type Employee, type PageToken, type SortDirection, type SortField } from "./shared";

// «فهرست کارکنان»: search + sort controls, the table (with each row's
// expandable detail), and the page-number footer. All state — query,
// sort, page, expanded row — and the filter/sort/paging computation
// (including buildPageNumbers) live in page.tsx and are passed in.
export function EmployeeListSection({
  employees,
  sortedEmployees,
  pagedEmployees,
  loading,
  canManage,
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
  expandedId,
  setExpandedId,
  onEdit,
}: {
  employees: Employee[];
  sortedEmployees: Employee[];
  pagedEmployees: Employee[];
  loading: boolean;
  canManage: boolean;
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
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onEdit: (employee: Employee) => void;
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
                  {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                  <th className="px-4 py-3 font-medium">جزئیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedEmployees.map((employee) => {
                  const expanded = expandedId === employee.id;
                  return (
                    <Fragment key={employee.id}>
                      <tr className="hover:bg-muted/30">
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
                        <td className="px-4 py-3">{employee.firstName} {employee.lastName}</td>
                        <td className="px-4 py-3">{employee.department.name}</td>
                        <td className="px-4 py-3">{employee.position || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{statusLabels[employee.status]}</td>
                        {canManage ? (
                          <td className="px-4 py-3"><Button variant="link" size="sm" onClick={() => onEdit(employee)}>ویرایش</Button></td>
                        ) : null}
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={expanded ? "بستن جزئیات" : "نمایش جزئیات بیشتر"}
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : employee.id)}
                          >
                            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </Button>
                        </td>
                      </tr>
                      {expanded ? <EmployeeDetailRow employee={employee} colSpan={canManage ? 8 : 7} /> : null}
                    </Fragment>
                  );
                })}
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
