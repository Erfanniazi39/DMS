import { Prisma } from '@prisma/client';

// Keeps a complete snapshot of a business record when it is deleted, so it can be
// viewed and restored afterwards (see audit/restore). Called inside the delete's
// own transaction (same `tx`) so the snapshot and the delete commit or roll back
// together.

export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(): number {
  const parsed = Number(process.env.DMS_DELETED_RECORD_RETENTION_DAYS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

// Values hidden when a snapshot is DISPLAYED (same rule as AuditLog.details). The
// stored snapshot is complete — a restore must bring back every piece of
// information, including identifiers and bank numbers — so masking happens on
// the way out (maskForDisplay), never on the way in. The archive is readable by
// admins only (users.create) and holds nothing the source tables didn't.
const SENSITIVE_KEYS = /^(nationalId|passwordHash|shebaNumber|accountNumber|bankAccountNumber|bankShebaNumber|cardNumber|salary)$/;

// JSON round-trip (Decimal → string, Date → ISO). Nothing is masked here.
export function toSnapshot(record: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(record)) as Prisma.InputJsonValue;
}

// The snapshot as shown on screen: sensitive keys replaced by '***' at any depth.
export function maskForDisplay(snapshot: unknown): unknown {
  return JSON.parse(JSON.stringify(snapshot), (key, value) => (SENSITIVE_KEYS.test(key) && value !== null ? '***' : value));
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
