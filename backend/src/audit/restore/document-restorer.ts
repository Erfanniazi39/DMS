import { BaseRestorer } from './base-restorer';
import type { RestoreContext, RestoreResult } from './restore.types';
import { rowsOf, scalarData } from './snapshot-data';

type Delegate = { create(args: { data: unknown }): Promise<{ id: number }>; createMany(args: { data: unknown[] }): Promise<unknown> };

// A deleted draft document (header + lines) comes back exactly as it was: same
// id, same fields, same status, same lines. Drafts carry no document number and
// have touched no stock, receivable or counter, so re-inserting them is safe;
// posting the restored draft re-runs every normal rule. Parent records that
// have vanished since surface as a clear 409 (foreign-key refusal).
// Subclasses live in the module that owns the document (CLAUDE.md rule 11).
export abstract class DocumentRestorer extends BaseRestorer {
  // Prisma model names, e.g. 'Delivery' / 'DeliveryItem'.
  protected abstract readonly model: string;
  protected abstract readonly itemModel: string;
  // Prisma client delegate keys, e.g. 'delivery' / 'deliveryItem'.
  protected abstract readonly delegate: string;
  protected abstract readonly itemDelegate: string;
  protected abstract readonly auditEntity: string;
  protected abstract readonly auditAction: string;
  protected abstract describe(record: Record<string, unknown>): string;

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const client = tx as unknown as Record<string, Delegate>;
    const header = await client[this.delegate].create({ data: scalarData(this.model, record) });
    const lines = rowsOf(record.items);
    if (lines.length > 0) await client[this.itemDelegate].createMany({ data: lines.map((line) => scalarData(this.itemModel, line)) });
    await this.audit.log({ userId, ipAddress, action: this.auditAction, entityType: this.auditEntity, entityId: header.id, details: this.describe(record) }, tx);
    return { entityId: header.id };
  }
}
