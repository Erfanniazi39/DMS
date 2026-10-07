import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// The entityType values written to AUDIT_LOG today. Shared because each one
// is written by its owning module and read back elsewhere (Dashboard's
// recent-activity feed filters on Purchase/PurchaseRequest). Deliberately
// just the existing values, not an event taxonomy — `action` strings stay
// owned by (and local to) each writing module.
export const AUDIT_ENTITY = {
  PURCHASE: 'Purchase',
  PURCHASE_REQUEST: 'PurchaseRequest',
  CUSTOMER: 'Customer',
  ITEM: 'Item',
  // Customer-module reference data (customer groups, territories, payment
  // terms). Customer child records (contacts, addresses, notes, documents,
  // complaints, financial profile) are logged under CUSTOMER with the
  // customer's id, so one customer's history is one entity's history.
  CUSTOMER_GROUP: 'CustomerGroup',
  TERRITORY: 'Territory',
  PAYMENT_TERM: 'PaymentTerm',
  // Inventory (Sales batch 1). StockMovement rows are their own audit trail
  // (append-only, with createdByUserId); the source document is what's logged.
  STOCK_ADJUSTMENT: 'StockAdjustment',
} as const;

// One field-level change recorded in AuditLog.changes (added 2026-10-06 for
// the Customer module's sensitive-field tracking).
export type AuditChange = { field: string; from: unknown; to: unknown };

// What a sensitive field's value is recorded as — "it changed", never the
// value itself (e.g. Customer.nationalId).
export const MASKED_AUDIT_VALUE = '***';

function toComparable(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  // Prisma.Decimal — compare/record its exact string form.
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

// Builds the AuditLog.changes array for the given fields: one entry per field
// whose value differs between `before` and `after`. Fields in `masked` are
// recorded as MASKED_AUDIT_VALUE (or null when empty) on both sides.
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
  options: { masked?: readonly string[] } = {},
): AuditChange[] {
  const masked = new Set(options.masked ?? []);
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const from = toComparable(before[field]);
    const to = toComparable(after[field]);
    if (from === to) continue;
    if (masked.has(field)) {
      changes.push({ field, from: from === null ? null : MASKED_AUDIT_VALUE, to: to === null ? null : MASKED_AUDIT_VALUE });
    } else {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

export type AuditEntry = {
  userId: number | null;
  action: string;
  ipAddress?: string;
  // Omitted for events that aren't about a business record (LOGIN, LOGOUT,
  // LOGIN_FAILED:...) — the row then has no entityType/entityId at all.
  entityType?: string;
  entityId?: number;
  details?: string;
  // Optional field-level diff (see diffChanges()). Omitted/empty = no
  // `changes` value is written, exactly as before.
  changes?: AuditChange[];
};

// The one writer for the shared AUDIT_LOG table. Replaces the identical
// private writeAuditLog() helpers each module used to carry (Purchases,
// Purchase Requests, Customers, Items, Auth) — the rows written are exactly
// what those helpers wrote; only where the code lives changed. Still
// deliberately minimal (see database_plan.txt's note on AUDIT_LOG: keep this
// simple, no elaborate event taxonomy). Callers decide what goes in
// `details` — never put sensitive values (national ID, bank/Sheba, salary,
// passwords) there.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // `client` lets a caller write the audit row inside its own $transaction,
  // so the business change and its audit entry commit (or roll back)
  // together. Omitted = the plain PrismaService, as before.
  async log(entry: AuditEntry, client?: Prisma.TransactionClient) {
    const db = client ?? this.prisma;
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? undefined,
        action: entry.action,
        ...(entry.entityType !== undefined ? { entityType: entry.entityType } : {}),
        ...(entry.entityId !== undefined ? { entityId: String(entry.entityId) } : {}),
        ...(entry.details !== undefined ? { details: entry.details } : {}),
        ipAddress: entry.ipAddress ?? undefined,
        ...(entry.changes && entry.changes.length > 0 ? { changes: entry.changes as Prisma.InputJsonValue } : {}),
      },
    });
  }

  // Newest-first history of one record (e.g. a customer's history tab).
  // Never selects ipAddress.
  async listForEntity(entityType: string, entityId: number, limit = 200) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId: String(entityId) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        action: true,
        details: true,
        changes: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    });
  }

  // Newest-first read of entries about the given entity types, for activity
  // feeds. Never selects ipAddress. Rows without an entityType (auth events:
  // LOGIN/LOGOUT/LOGIN_FAILED) can't match an entityTypes filter, so they're
  // never included.
  async listRecent(options: { entityTypes: readonly string[]; limit: number }) {
    return this.prisma.auditLog.findMany({
      where: { entityType: { in: [...options.entityTypes] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        details: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    });
  }
}
