import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
