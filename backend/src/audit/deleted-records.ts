import { Prisma } from '@prisma/client';

// Keeps a view-only snapshot of a business record when it is deleted, so the
// activity feed's "X was deleted" can still be answered afterwards. Called
// inside the delete's own transaction (same `tx`) so the snapshot and the
// delete commit or roll back together. Not a restore mechanism.

export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(): number {
  const parsed = Number(process.env.DMS_DELETED_RECORD_RETENTION_DAYS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

// Values that must never be copied into a snapshot (same rule as AuditLog.details).
const SENSITIVE_KEYS = /^(nationalId|passwordHash|shebaNumber|accountNumber|cardNumber|salary)$/;

// JSON round-trip (Decimal → string, Date → ISO) with sensitive keys masked.
export function toSnapshot(record: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(record), (key, value) => (SENSITIVE_KEYS.test(key) && value !== null ? '***' : value)) as Prisma.InputJsonValue;
}

export type DeletedRecordEntry = {
  entityType: string;
  entityId: number;
  // Human-readable identifier, e.g. the document number.
  label?: string | null;
  record: unknown;
  userId: number | null;
};

export async function archiveDeletedRecord(client: Pick<Prisma.TransactionClient, 'deletedRecord'>, entry: DeletedRecordEntry) {
  const now = new Date();
  await client.deletedRecord.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      label: entry.label ?? null,
      snapshot: toSnapshot(entry.record),
      deletedByUserId: entry.userId,
      deletedAt: now,
      expiresAt: new Date(now.getTime() + retentionDays() * 24 * 60 * 60 * 1000),
    },
  });
}
