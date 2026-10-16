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
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ last_value: 42 }]) };

    await expect(nextDocumentNumber(tx as never, 'ADJ', new Date('2026-10-06T00:00:00Z'))).resolves.toBe('ADJ-1405-000042');

    const [strings, ...values] = tx.$queryRaw.mock.calls[1];
    const sql = (strings as string[]).join('?');
    expect(sql).toContain('INSERT INTO document_sequences');
    expect(sql).toContain('ON CONFLICT (doc_type, fiscal_year)');
    expect(sql).toContain('last_value = document_sequences.last_value + 1');
    expect(sql).toContain('RETURNING last_value');
    expect(values).toEqual(['ADJ', 1405]);
  });

  it('uses the document date’s Jalali year, so a new year restarts at 000001', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ last_value: 1 }]) };
    await expect(nextDocumentNumber(tx as never, 'ADJ', new Date('2027-03-21T00:00:00Z'))).resolves.toBe('ADJ-1406-000001');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['ADJ', 1406]);
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

describe('nextDocumentNumber with a company format', () => {
  const formatRow = (over: Record<string, unknown>) => ({ prefix: 'SO', middle_mode: 'year', middle_text: null, separator: '-', digits: 6, ...over });

  it('uses a fixed middle part and one continuing counter (key 0)', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([formatRow({ middle_mode: 'fixed', middle_text: '7050' })]).mockResolvedValue([{ last_value: 5 }]) };
    await expect(nextDocumentNumber(tx as never, 'SO', new Date('2026-10-06T00:00:00Z'))).resolves.toBe('SO-7050-000005');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['SO', 0]);
  });

  it('supports no middle part, custom digits, prefix and separator', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([formatRow({ prefix: 'فا', middle_mode: 'none', separator: '/', digits: 4 })]).mockResolvedValue([{ last_value: 12 }]) };
    await expect(nextDocumentNumber(tx as never, 'SO', new Date('2026-10-06T00:00:00Z'))).resolves.toBe('فا/0012');
  });

  it('keeps the yearly counter for a year format with another prefix', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([formatRow({ prefix: 'ORD', digits: 5 })]).mockResolvedValue([{ last_value: 3 }]) };
    await expect(nextDocumentNumber(tx as never, 'SO', new Date('2026-10-06T00:00:00Z'))).resolves.toBe('ORD-1405-00003');
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['SO', 1405]);
  });
});
