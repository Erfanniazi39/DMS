"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "../admin/layout";
import { EmployeeListSection } from "./_sections/EmployeeListSection";
import {
  PAGE_SIZE,
  STATUS_SORT_RANK,
  type Employee,
  type PageToken,
  type SortDirection,
  type SortField,
} from "./_sections/shared";

// List/filter/sort/pagination state, the add/edit form state and the
// load/validate/save flow live here; the list (with its detail rows) and
// the form popup are rendered by the components in ./_sections.

// Age in whole years as of today. Returns null when birthDate is missing or
// unparseable, so it can be sorted to the end regardless of direction.
function computeAgeInYears(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Windowed page numbers with "..." gaps, so a large employee list doesn't
// render a button for every single page.
function buildPageNumbers(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages: PageToken[] = [1];
  if (current > 3) pages.push("start-ellipsis");
  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);
  for (let pageNumber = rangeStart; pageNumber <= rangeEnd; pageNumber += 1) pages.push(pageNumber);
  if (current < total - 2) pages.push("end-ellipsis");
  pages.push(total);
  return pages;
}

export default function EmployeesPage() {
  const user = useAdminUser();
  // employees.view reads the list (also granted to PURCHASE_MANAGER for the
  // buyer/requester dropdowns); create/edit need employees.manage.
  const canView = user?.permissions.includes("employees.view") ?? false;
  const canManage = user?.permissions.includes("employees.manage") ?? false;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("department");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const { toasts, pushError, dismiss } = useToasts();

  async function load() {
    setLoading(true);
    try {
      setEmployees(await apiFetch<Employee[]>("/employees"));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات کارکنان ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    const run = async () => load();
    void run();
    // Load employee data once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return employees;
    return employees.filter((employee) => {
      const haystack = [
        employee.code,
        employee.firstName,
        employee.lastName,
        employee.position ?? "",
        employee.nationalId ?? "",
        employee.mobilePhone ?? "",
        employee.landlinePhone ?? "",
        employee.email ?? "",
        employee.department.name,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [employees, query]);

  const sortedEmployees = useMemo(() => {
    const directionMultiplier = sortDirection === "asc" ? 1 : -1;
    // Missing data (no birth/hire date) always sorts to the end, regardless
    // of ascending/descending, so it doesn't jump to the top on "descending".
    const compareWithNullsLast = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * directionMultiplier;
    };
    const list = [...filteredEmployees];
    list.sort((a, b) => {
      switch (sortField) {
        case "department":
          return a.department.name.localeCompare(b.department.name, "fa") * directionMultiplier;
        case "name":
          return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "fa") * directionMultiplier;
        case "age":
          return compareWithNullsLast(computeAgeInYears(a.birthDate), computeAgeInYears(b.birthDate));
        case "tenure":
          return compareWithNullsLast(a.tenure.days > 0 ? a.tenure.days : null, b.tenure.days > 0 ? b.tenure.days : null);
        case "status":
          return (STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status]) * directionMultiplier;
        default:
          return 0;
      }
    });
    return list;
  }, [filteredEmployees, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedEmployees.length / PAGE_SIZE));
  const pagedEmployees = useMemo(
    () => sortedEmployees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedEmployees, page],
  );
  const pageNumbers = useMemo(() => buildPageNumbers(page, totalPages), [page, totalPages]);

  // A new search or sort choice starts back at page 1 (done in those
  // controls' own handlers), so the user isn't silently left on a now
  // out-of-range page.
  // If the list shrinks (e.g. after a delete) below the current page,
  // clamp back to the last real page instead of showing an empty one.
  // Adjusted during render (React's "adjusting state when props change"
  // pattern) rather than in an effect, so there's no extra render pass.
  if (page > totalPages) setPage(totalPages);

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به کارکنان را ندارید.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">کارکنان</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت کارکنان و واحد سازمانی هر کارمند</p>
          </div>
          {canManage ? (
            <Link href="/employees/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <UserPlus className="size-4" aria-hidden="true" />
              افزودن کارمند
            </Link>
          ) : null}
        </div>

        <EmployeeListSection
          employees={employees}
          sortedEmployees={sortedEmployees}
          pagedEmployees={pagedEmployees}
          loading={loading}
          query={query}
          setQuery={setQuery}
          sortField={sortField}
          setSortField={setSortField}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          pageNumbers={pageNumbers}
        />
      </div>

    </div>
  );
}
