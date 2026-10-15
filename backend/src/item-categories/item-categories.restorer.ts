import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { scalarData } from '../audit/restore/snapshot-data';

@Injectable()
export class ItemCategoriesRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.ITEM_CATEGORY;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const code = String(record.code);
    const nameFa = String(record.nameFa);
    const clash = await tx.itemCategory.findFirst({ where: { OR: [{ code }, { nameFa }] }, select: { code: true } });
    if (clash) throw new ConflictException(clash.code === code ? 'کد این دسته‌بندی اکنون برای دسته‌بندی دیگری استفاده شده است' : 'دسته‌بندی با همین نام فارسی اکنون وجود دارد');
    const row = await tx.itemCategory.create({ data: scalarData('ItemCategory', record) as never });
    await this.audit.log({ userId, ipAddress, action: 'ITEM_CATEGORY_RESTORED', entityType: AUDIT_ENTITY.ITEM_CATEGORY, entityId: row.id, details: `${row.code} — ${row.nameFa}` }, tx);
    return { entityId: row.id };
  }
}
