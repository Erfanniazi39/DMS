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
