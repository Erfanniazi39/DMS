import { formatDocumentNumber, jalaliYearOf, nextDocumentNumber } from './document-sequence';

// Gap-free per-type, per-Jalali-year document numbers. The atomicity and
// "no gaps / no duplicates" guarantees come from Postgres (one
// INSERT … ON CONFLICT DO UPDATE … RETURNING inside the caller's
// transaction — see the file comment); these tests pin the SQL shape, the
// year derivation, and the formatting.

describe('jalaliYearOf', () => {
  it('switches year at Nowruz (calendar dates stored as UTC midnight)', () => {
    expect(jalaliYearOf(new Date('2025-03-20T00:00:00Z'))).toBe(1403);
    expect(jalaliYearOf(new Date('2025-03-21T00:00:00Z'))).toBe(1404);
    expect(jalaliYearOf(new Date('2026-03-20T00:00:00Z'))).toBe(1404);
    expect(jalaliYearOf(new Date('2026-03-21T00:00:00Z'))).toBe(1405);
    expect(jalaliYearOf(new Date('2026-10-06T00:00:00Z'))).toBe(1405);
  });
});

describe('formatDocumentNumber', () => {
  it('formats <type>-<jalali year>-<6-digit zero-padded>', () => {
    expect(formatDocumentNumber('ADJ', 1405, 1)).toBe('ADJ-1405-000001');
    expect(formatDocumentNumber('INV', 1405, 123456)).toBe('INV-1405-123456');
  });
});

describe('nextDocumentNumber', () => {
  it('increments the (docType, Jalali year) counter with one atomic upsert … RETURNING on the caller’s transaction client', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ last_value: 42 }]) };

    await expect(nextDocumentNumber(tx as never, 'ADJ', new Date('2026-10-06T00:00:00Z'))).resolves.toBe('ADJ-1405-000042');

    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');
    expect(sql).toContain('INSERT INTO document_sequences');
    expect(sql).toContain('ON CONFLICT (doc_type, fiscal_year)');
    expect(sql).toContain('last_value = document_sequences.last_value + 1');
    expect(sql).toContain('RETURNING last_value');
    expect(values).toEqual(['ADJ', 1405]);
  });

  it('uses the document date’s Jalali year, so a new year restarts at 000001', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]) };
    await expect(nextDocumentNumber(tx as never, 'ADJ', new Date('2027-03-21T00:00:00Z'))).resolves.toBe('ADJ-1406-000001');
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['ADJ', 1406]);
  });

  it('rejects a malformed docType (programming error) without touching the database', async () => {
    const tx = { $queryRaw: jest.fn() };
    await expect(nextDocumentNumber(tx as never, 'adj; DROP', new Date())).rejects.toThrow('Invalid document type');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails loudly if the counter returns nothing', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await expect(nextDocumentNumber(tx as never, 'ADJ', new Date('2026-10-06T00:00:00Z'))).rejects.toThrow();
  });
});
