import { computeTenure, findOverlap, summarizeContracts } from './employee-tenure';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('computeTenure', () => {
  it('sums consecutive contracts (monthly, then yearly) inclusively and merges touching periods', () => {
    const tenure = computeTenure({
      hireDate: d('2024-01-01'),
      contracts: [
        { contractType: 'temporary', startDate: d('2024-01-01'), endDate: d('2024-01-31') },
        { contractType: 'temporary', startDate: d('2024-02-01'), endDate: d('2025-01-31') },
      ],
      terminationDate: null,
      asOf: d('2026-01-01'),
    });
    expect(tenure.basis).toBe('contracts');
    expect(tenure.periods).toEqual([{ start: '2024-01-01', end: '2025-01-31', days: 397 }]);
    expect(tenure.days).toBe(397);
  });

  it('does not count the gap between contracts, and an open-ended contract runs to today', () => {
    const tenure = computeTenure({
      hireDate: null,
      contracts: [
        { contractType: 'temporary', startDate: d('2024-01-01'), endDate: d('2024-01-10') },
        { contractType: 'permanent', startDate: d('2024-03-01'), endDate: null },
      ],
      terminationDate: null,
      asOf: d('2024-03-10'),
    });
    expect(tenure.days).toBe(10 + 10);
    expect(tenure.periods).toHaveLength(2);
  });

  it('stops at the termination date, ignores contracts starting after it, and never counts a day twice', () => {
    const tenure = computeTenure({
      hireDate: null,
      contracts: [
        { contractType: 'temporary', startDate: d('2024-01-01'), endDate: d('2024-12-31') },
        { contractType: 'temporary', startDate: d('2024-06-01'), endDate: d('2025-06-01') },
        { contractType: 'temporary', startDate: d('2025-09-01'), endDate: d('2025-12-31') },
      ],
      terminationDate: d('2024-12-31'),
      asOf: d('2026-01-01'),
    });
    expect(tenure.days).toBe(366);
  });

  it('falls back to the hire date without contracts, and is zero with nothing', () => {
    expect(computeTenure({ hireDate: d('2024-01-01'), contracts: [], terminationDate: null, asOf: d('2024-01-10') })).toEqual({ days: 10, basis: 'hire_date', periods: [{ start: '2024-01-01', end: '2024-01-10', days: 10 }] });
    expect(computeTenure({ hireDate: null, contracts: [], terminationDate: null }).days).toBe(0);
  });
});

describe('summarizeContracts / findOverlap', () => {
  it('current = latest start; reports days to expiry and lapsed contracts', () => {
    const contracts = [
      { contractType: 'temporary' as const, startDate: d('2024-01-01'), endDate: d('2024-01-31') },
      { contractType: 'temporary' as const, startDate: d('2024-02-01'), endDate: d('2024-12-31') },
    ];
    expect(summarizeContracts(contracts, d('2024-12-01'))).toEqual(expect.objectContaining({ daysToExpiry: 30, expired: false }));
    expect(summarizeContracts(contracts, d('2025-01-10'))).toEqual(expect.objectContaining({ daysToExpiry: -10, expired: true }));
    expect(summarizeContracts([{ contractType: 'permanent', startDate: d('2024-01-01'), endDate: null }]).daysToExpiry).toBeNull();
    expect(summarizeContracts([]).current).toBeNull();
  });

  it('finds an overlapping period, allows back-to-back ones, and can ignore the contract being edited', () => {
    const existing = [{ id: 1, startDate: d('2024-01-01'), endDate: d('2024-01-31') }];
    expect(findOverlap(existing, d('2024-01-31'), d('2024-03-01'))?.id).toBe(1);
    expect(findOverlap(existing, d('2024-02-01'), d('2024-03-01'))).toBeNull();
    expect(findOverlap(existing, d('2023-12-01'), null)?.id).toBe(1);
    expect(findOverlap(existing, d('2024-01-05'), d('2024-01-10'), 1)).toBeNull();
  });
});
