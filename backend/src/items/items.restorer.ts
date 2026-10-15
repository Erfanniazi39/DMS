import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { scalarData } from '../audit/restore/snapshot-data';

// A deleted item comes back with its original id and fields, provided its code
// and name are still free and its category and unit still exist.
@Injectable()
export class ItemsRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.ITEM;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const code = String(record.code);
    const name = String(record.name);
    const clash = await tx.item.findFirst({ where: { OR: [{ code }, { name }] }, select: { code: true } });
    if (clash) throw new ConflictException(clash.code === code ? 'کد این کالا اکنون برای کالای دیگری استفاده شده است' : 'کالایی با همین نام اکنون وجود دارد');
    const [category, unit] = await Promise.all([
      tx.itemCategory.findUnique({ where: { id: Number(record.categoryId) }, select: { id: true } }),
      tx.unit.findUnique({ where: { id: Number(record.unitId) }, select: { id: true } }),
    ]);
    if (!category) throw new ConflictException('دسته‌بندی این کالا دیگر وجود ندارد؛ ابتدا آن را بازیابی یا دوباره بسازید');
    if (!unit) throw new ConflictException('واحد این کالا دیگر وجود ندارد؛ ابتدا آن را بازیابی یا دوباره بسازید');
    const row = await tx.item.create({ data: scalarData('Item', record) as never });
    await this.audit.log({ userId, ipAddress, action: 'ITEM_RESTORED', entityType: AUDIT_ENTITY.ITEM, entityId: row.id, details: row.code }, tx);
    return { entityId: row.id };
  }
}
