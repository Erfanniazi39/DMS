"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { LIST_PAGE_SIZE } from "@/components/ui/list-pagination";
import { nextSort, sortRows, type SortState, type SortValue } from "@/lib/table-sort";

// Clickable column header: <SortHeader label="نام" sortKey="name" sort={sort} onSort={toggle} />.
// Drop-in for `<th className="px-4 py-3 font-medium">`; pass `className` to
// keep a page's own header padding. Shows the direction arrow when active.
export function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "px-4 py-3 font-medium",
}: {
  label: ReactNode;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", active && "text-foreground")}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

/**
 * Sort state for a SERVER-side sorted list. `onSort` cycles asc → desc →
 * default; `onChange` (optional) lets the page reset to page 1 when the sort
 * changes. Send `sortQuery(sort)` with the list request.
 */
export function useTableSort(initial: SortState = null, onChange?: () => void) {
  const [sort, setSort] = useState<SortState>(initial);
  const onSort = useCallback(
    (key: string) => {
      setSort((current) => nextSort(current, key));
      onChange?.();
    },
    [onChange],
  );
  return { sort, onSort };
}

/**
 * Sort + page rows that are ALREADY in memory (small bounded tables: reference
 * data, a customer's contacts, history logs). Never use it for a list that can
 * grow large — those are paginated by the server.
 */
export function useClientTable<T>(rows: readonly T[], getters: Record<string, (row: T) => SortValue>, options: { pageSize?: number; initialSort?: SortState } = {}) {
  const pageSize = options.pageSize ?? LIST_PAGE_SIZE;
  const [sort, setSort] = useState<SortState>(options.initialSort ?? null);
  const [requestedPage, setPage] = useState(1);
  const sorted = useMemo(() => sortRows(rows, getters, sort), [rows, getters, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);
  const onSort = useCallback((key: string) => {
    setSort((current) => nextSort(current, key));
    setPage(1);
  }, []);
  return { sort, onSort, page, setPage, pageSize, total: sorted.length, pageRows, sortedRows: sorted };
}
