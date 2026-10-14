import type { ContractType } from '@prisma/client';

// Pure helpers (no DI) for an employee's contract history and working time —
// the single place where "how long has this person worked here" is defined.
//
// Tenure is counted from the CONTRACT periods (owner, 2026-10-14): each
// contract covers startDate..endDate inclusive (a permanent contract, or the
// current one with no end, runs to the cut-off). The cut-off is the
// termination date if the employee left, otherwise "today"; a period is
// never counted past it. Overlapping periods are merged so no day counts
// twice, and the gaps between contracts are NOT counted. An employee with no
// contract at all falls back to hireDate → cut-off.

const DAY_MS = 24 * 60 * 60 * 1000;

export type ContractPeriod = { contractType: ContractType; startDate: Date; endDate: Date | null };

export type Tenure = {
  /** Total counted days (inclusive). */
  days: number;
  /** What the figure is based on. */
  basis: 'contracts' | 'hire_date' | 'none';
  /** The merged periods actually counted, ISO days — for display / export. */
  periods: { start: string; end: string; days: number }[];
};

export type ContractSummary = {
  /** The latest contract by start date, or null. */
  current: (ContractPeriod & { id?: number }) | null;
  /** Days until the current contract ends (negative = already lapsed); null for open-ended. */
  daysToExpiry: number | null;
  /** The latest contract has ended and nothing replaced it. */
  expired: boolean;
};

const startOfUtcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inclusiveDays = (startMs: number, endMs: number) => Math.round((endMs - startMs) / DAY_MS) + 1;

export function computeTenure(input: { hireDate: Date | null; contracts: ContractPeriod[]; terminationDate: Date | null; asOf?: Date }): Tenure {
  const cutoff = startOfUtcDay(input.terminationDate ?? input.asOf ?? new Date());
  const raw =
    input.contracts.length > 0
      ? input.contracts.map((contract) => ({ start: startOfUtcDay(contract.startDate), end: contract.endDate ? startOfUtcDay(contract.endDate) : cutoff }))
      : input.hireDate
        ? [{ start: startOfUtcDay(input.hireDate), end: cutoff }]
        : [];
  const basis: Tenure['basis'] = input.contracts.length > 0 ? 'contracts' : input.hireDate ? 'hire_date' : 'none';

  // Clip to the cut-off, drop periods that start after it, then merge overlaps/touching days.
  const clipped = raw
    .map((period) => ({ start: period.start, end: Math.min(period.end, cutoff) }))
    .filter((period) => period.start <= period.end)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const period of clipped) {
    const last = merged[merged.length - 1];
    if (last && period.start <= last.end + DAY_MS) last.end = Math.max(last.end, period.end);
    else merged.push({ ...period });
  }
  const periods = merged.map((period) => ({ start: isoDay(period.start), end: isoDay(period.end), days: inclusiveDays(period.start, period.end) }));
  return { days: periods.reduce((sum, period) => sum + period.days, 0), basis, periods };
}

export function summarizeContracts<T extends ContractPeriod>(contracts: T[], asOf: Date = new Date()): ContractSummary & { current: T | null } {
  const sorted = [...contracts].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  const current = sorted[0] ?? null;
  if (!current) return { current: null, daysToExpiry: null, expired: false };
  if (!current.endDate) return { current, daysToExpiry: null, expired: false };
  const daysToExpiry = Math.round((startOfUtcDay(current.endDate) - startOfUtcDay(asOf)) / DAY_MS);
  return { current, daysToExpiry, expired: daysToExpiry < 0 };
}

/** The first existing contract that overlaps [start, end] (end null = open-ended), if any. */
export function findOverlap<T extends { id: number; startDate: Date; endDate: Date | null }>(existing: T[], start: Date, end: Date | null, ignoreId?: number): T | null {
  const newStart = startOfUtcDay(start);
  const newEnd = end ? startOfUtcDay(end) : Infinity;
  return (
    existing.find((contract) => {
      if (contract.id === ignoreId) return false;
      const otherStart = startOfUtcDay(contract.startDate);
      const otherEnd = contract.endDate ? startOfUtcDay(contract.endDate) : Infinity;
      return newStart <= otherEnd && otherStart <= newEnd;
    }) ?? null
  );
}
