import type { Prisma } from '@prisma/client';
import { DEFAULT_DIGITS, DEFAULT_SEPARATOR, MIDDLE_MODES, counterKey, defaultDocumentNumberFormat, renderDocumentNumber, type DocumentNumberFormat, type MiddleMode } from './document-number-format';

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
// document_sequences is written ONLY here (and by NumberingService when the
// company raises a counter's next number). The number's look — prefix, year /
// fixed text, digits — comes from numbering_formats (default: PREFIX-<year>-000001);
// the counter itself only ever goes up, so a format change can't repeat a number.

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
  return renderDocumentNumber(defaultDocumentNumberFormat(docType), fiscalYear, value);
}

// The company's chosen format for this document type (numbering_formats, written
// by the Numbering module's settings page). No row → the default format. Read
// with the caller's transaction so a settings change and a posting can't interleave oddly.
async function loadFormat(tx: Prisma.TransactionClient, docType: string): Promise<DocumentNumberFormat> {
  const rows = await tx.$queryRaw<{ prefix?: unknown; middle_mode?: unknown; middle_text?: unknown; separator?: unknown; digits?: unknown }[]>`
    SELECT prefix, middle_mode, middle_text, separator, digits FROM numbering_formats WHERE doc_type = ${docType}`;
  const row = rows[0];
  if (!row || typeof row.prefix !== 'string' || !(MIDDLE_MODES as readonly unknown[]).includes(row.middle_mode)) return defaultDocumentNumberFormat(docType);
  return {
    prefix: row.prefix,
    middleMode: row.middle_mode as MiddleMode,
    middleText: typeof row.middle_text === 'string' ? row.middle_text : null,
    separator: typeof row.separator === 'string' ? row.separator : DEFAULT_SEPARATOR,
    digits: Number(row.digits) || DEFAULT_DIGITS,
  };
}

export async function nextDocumentNumber(tx: Prisma.TransactionClient, docType: string, date: Date): Promise<string> {
  if (!DOC_TYPE_PATTERN.test(docType)) throw new Error(`Invalid document type: ${docType}`);
  const format = await loadFormat(tx, docType);
  const fiscalYear = jalaliYearOf(date);
  const key = counterKey(format, fiscalYear);
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_sequences (doc_type, fiscal_year, last_value)
    VALUES (${docType}, ${key}, 1)
    ON CONFLICT (doc_type, fiscal_year)
    DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value`;
  const value = Number(rows[0]?.last_value);
  if (!Number.isInteger(value) || value < 1) throw new Error('Document sequence did not return a value');
  return renderDocumentNumber(format, fiscalYear, value);
}

// Settings support (NumberingService): the counter's current value, and raising it
// so the NEXT number is `nextNumber`. A counter only ever goes up — lowering it could
// repeat a number that was already issued.
export async function readCounter(tx: Prisma.TransactionClient, docType: string, key: number): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    SELECT last_value FROM document_sequences WHERE doc_type = ${docType} AND fiscal_year = ${key} FOR UPDATE`;
  return Number(rows[0]?.last_value ?? 0);
}

export async function setCounter(tx: Prisma.TransactionClient, docType: string, key: number, lastValue: number): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO document_sequences (doc_type, fiscal_year, last_value) VALUES (${docType}, ${key}, ${lastValue})
    ON CONFLICT (doc_type, fiscal_year) DO UPDATE SET last_value = ${lastValue}`;
}
