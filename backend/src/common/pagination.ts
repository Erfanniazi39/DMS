import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type PaginationParams = { page: number; pageSize: number };

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// Pagination on list endpoints is opt-in: when neither `page` nor `pageSize`
// is in the query string this returns undefined and the endpoint keeps its
// original plain-array response. Dropdowns (e.g. the supplier picker on the
// purchase form/filters) rely on getting the full array back.
export function parsePagination(page?: string, pageSize?: string): PaginationParams | undefined {
  if (page === undefined && pageSize === undefined) return undefined;

  const parsedPage = page === undefined || page === '' ? 1 : Number(page);
  const parsedPageSize = pageSize === undefined || pageSize === '' ? DEFAULT_PAGE_SIZE : Number(pageSize);

  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    throw new BadRequestException('شماره صفحه نامعتبر است');
  }
  if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException(`تعداد ردیف در هر صفحه باید بین ۱ و ${MAX_PAGE_SIZE} باشد`);
  }
  return { page: parsedPage, pageSize: parsedPageSize };
}

export function toSkipTake({ page, pageSize }: PaginationParams) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// --- Sorting (click a column header → ?sortBy=<column>&sortDir=asc|desc) ------
// Every list endpoint declares the columns it can sort by (a whitelist mapping
// a public column key to a Prisma orderBy fragment); the client can never
// sort by an arbitrary field. Sorting is opt-in like pagination: without
// `sortBy` the endpoint keeps its own default order. A stable tie-break is
// always appended so page boundaries don't shuffle between requests.

export type SortDir = 'asc' | 'desc';
export type SortParams = { sortBy: string; sortDir: SortDir };

export function parseSort(sortBy?: string, sortDir?: string): SortParams | undefined {
  const by = sortBy?.trim();
  if (!by) return undefined;
  const dir = sortDir?.trim().toLowerCase() || 'asc';
  if (dir !== 'asc' && dir !== 'desc') throw new BadRequestException('جهت مرتب‌سازی نامعتبر است');
  return { sortBy: by, sortDir: dir };
}

// `columns` maps each sortable key to its orderBy fragment, e.g.
//   { name: (dir) => ({ name: dir }), supplier: (dir) => ({ supplier: { name: dir } }) }
// `fallback` is the endpoint's default order (used when no sort was asked
// for); `tieBreak` is appended after a requested sort.
export function buildOrderBy<T>(
  sort: SortParams | undefined,
  columns: Record<string, (dir: SortDir) => T>,
  fallback: T[],
  tieBreak: T[],
): T[] {
  if (!sort) return fallback;
  const column = Object.prototype.hasOwnProperty.call(columns, sort.sortBy) ? columns[sort.sortBy] : undefined;
  if (!column) throw new BadRequestException('ستون مرتب‌سازی نامعتبر است');
  return [column(sort.sortDir), ...tieBreak];
}
