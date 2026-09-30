"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/jalali";

// Paginated list response shape returned by list endpoints when called with
// `page`/`pageSize` (see backend/src/common/pagination.ts). Without those
// params the same endpoints still return a plain array.
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const LIST_PAGE_SIZE = 20;

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

type ListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
};

// Footer bar for a paginated table — same look as the dashboard's "latest
// transactions" footer (outline icon-sm buttons, xs muted text), but live.
// RTL: the first child sits on the right, so "previous" (→ points right,
// back toward the start of the reading direction) comes first and "next"
// (← points left) second.
export function ListPagination({ page, pageSize, total, loading = false, onPageChange, className }: ListPaginationProps) {
  const pages = totalPages(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className={`flex items-center justify-between gap-3 text-xs text-muted-foreground ${className ?? ""}`}
      aria-busy={loading}
    >
      <span>
        {total === 0
          ? "بدون ردیف"
          : `نمایش ${toPersianDigits(from)} تا ${toPersianDigits(to)} از ${toPersianDigits(total)} ردیف`}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="صفحه قبل"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="min-w-20 text-center tabular-nums" aria-live="polite">
          صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="صفحه بعد"
          disabled={loading || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
