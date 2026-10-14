// Column sorting for tables. Two modes share one state shape:
//  - server-side (paginated lists): the page sends `sortBy`/`sortDir` and the
//    backend orders the whole result set (see backend common/pagination.ts);
//  - client-side (small bounded tables already in memory): sortRows() below.
// Click cycle on a header: ascending → descending → back to the default order.

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;

export function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Query-string fragment for a server-side sort ("" when none). Leading "&". */
export function sortQuery(sort: SortState): string {
  return sort ? `&sortBy=${encodeURIComponent(sort.key)}&sortDir=${sort.dir}` : "";
}

export type SortValue = string | number | boolean | Date | null | undefined;

const collator = new Intl.Collator("fa", { numeric: true, sensitivity: "base" });

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Sorted copy of `rows` by the accessor registered for `sort.key`; empty
 * values (null/undefined/"") always go last, whichever direction. Stable.
 * An unknown key or no sort returns the rows unchanged.
 */
export function sortRows<T>(rows: readonly T[], getters: Record<string, (row: T) => SortValue>, sort: SortState): T[] {
  const get = sort ? getters[sort.key] : undefined;
  if (!sort || !get) return [...rows];
  const factor = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((left, right) => {
      const leftEmpty = left.value === null || left.value === undefined || left.value === "";
      const rightEmpty = right.value === null || right.value === undefined || right.value === "";
      if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? left.index - right.index : leftEmpty ? 1 : -1;
      return compareValues(left.value, right.value) * factor || left.index - right.index;
    })
    .map((entry) => entry.row);
}
