import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
} as const;

export type AuditEntry = {
  userId: number | null;
  action: string;
  ipAddress?: string;
  // Omitted for events that aren't about a business record (LOGIN, LOGOUT,
  // LOGIN_FAILED:...) — the row then has no entityType/entityId at all.
  entityType?: string;
  entityId?: number;
  details?: string;
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
