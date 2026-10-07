import type { Prisma } from '@prisma/client';

// Gap-free, per-document-type, per-Jalali-year document numbers
// (business decision 2026-10-06, Sales batch 1) — e.g. "ADJ-1405-000001".
//
// Unlike PurchasesService.create() (which derives PUR-000001 from the row's
// autoincrement id at draft creation and therefore CAN leave holes — a
// rolled-back insert or a deleted draft burns an id), a number here is
// claimed only at POSTING time, inside the posting transaction:
//
//   INSERT … VALUES (docType, year, 1)
//   ON CONFLICT (doc_type, fiscal_year) DO UPDATE SET last_value = last_value + 1
//   RETURNING last_value
//
// - Atomic: one statement, evaluated by Postgres — no application-level
//   read-then-write race.
// - Serialized: the statement row-locks the (docType, year) counter until the
//   caller's transaction ends, so a second concurrent post of the same type
//   and year waits, then reads the committed value and gets the next number.
//   Two posts can never receive the same number (and adjustment_number etc.
//   are UNIQUE as a backstop).
// - Gap-free: if the caller's transaction rolls back (e.g. stock would go
//   negative), the increment rolls back with it.
// - The first number of a new year creates the row; ON CONFLICT makes two
//   concurrent "first of the year" posts safe as well.
//
// DI-free on purpose: takes the caller's transaction client, so it can be
// used by any module's posting transaction without a module import.
// document_sequences is written ONLY here.

// Business dates are stored as UTC midnight of their calendar day (see
// common/zod-fields.ts toIsoDay()), so the Jalali year is read in UTC — the
// same calendar day the user picked. Node ships full ICU (the Dashboard
// already relies on the Persian calendar the same way).
const jalaliYearFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric' });

export function jalaliYearOf(date: Date): number {
  const year = jalaliYearFormatter.formatToParts(date).find((part) => part.type === 'year')?.value;
  const parsed = Number(year);
  if (!Number.isInteger(parsed)) throw new Error(`Cannot compute Jalali year for ${date.toISOString()}`);
  return parsed;
}

// Short uppercase prefixes only ("ADJ", later "SO", "DN", "INV", "RMA", "CN",
// "RCP") — a programming error otherwise, never user input.
const DOC_TYPE_PATTERN = /^[A-Z]{2,5}$/;

export function formatDocumentNumber(docType: string, fiscalYear: number, value: number) {
  return `${docType}-${fiscalYear}-${String(value).padStart(6, '0')}`;
}

export async function nextDocumentNumber(tx: Prisma.TransactionClient, docType: string, date: Date): Promise<string> {
  if (!DOC_TYPE_PATTERN.test(docType)) throw new Error(`Invalid document type: ${docType}`);
  const fiscalYear = jalaliYearOf(date);
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_sequences (doc_type, fiscal_year, last_value)
    VALUES (${docType}, ${fiscalYear}, 1)
    ON CONFLICT (doc_type, fiscal_year)
    DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value`;
  const value = Number(rows[0]?.last_value);
  if (!Number.isInteger(value) || value < 1) throw new Error('Document sequence did not return a value');
  return formatDocumentNumber(docType, fiscalYear, value);
}
