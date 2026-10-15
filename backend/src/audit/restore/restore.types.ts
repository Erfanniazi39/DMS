import type { Prisma } from '@prisma/client';

// What an owning module needs to put a deleted record back. The audit module
// only dispatches (RestoreRegistry); every module re-inserts ITS OWN rows and
// applies ITS OWN rules (CLAUDE.md rule 11).
export type RestoreContext = {
  // The snapshot's JSON, as archived by archiveDeletedRecord().
  record: Record<string, unknown>;
  // The restore transaction. Everything the restorer writes joins it, so a
  // refusal (ConflictException) leaves nothing behind.
  tx: Prisma.TransactionClient;
  userId: number | null;
  ipAddress?: string;
};

export type RestoreResult = {
  // Id of the restored record (always the original id).
  entityId: number;
  // Things the user must still do, e.g. «کد ملی باید دوباره وارد شود».
  warnings?: string[];
  // Runs after the restore transaction commits (derived-state recomputes that
  // use their own transaction, e.g. a purchase request's status).
  afterCommit?: () => Promise<void>;
};

export interface DeletedRecordRestorer {
  // Same string the module passed to archiveDeletedRecord() as entityType.
  readonly entityType: string;
  restore(context: RestoreContext): Promise<RestoreResult>;
}
