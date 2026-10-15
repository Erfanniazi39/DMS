import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { scalarData } from '../audit/restore/snapshot-data';

// Puts a deleted unit back with its original id, unless its code or Persian
// name has been taken since.
@Injectable()
export class UnitsRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.UNIT;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const code = String(record.code);
    const nameFa = String(record.nameFa);
    const clash = await tx.unit.findFirst({ where: { OR: [{ code }, { nameFa }] }, select: { code: true } });
    if (clash) throw new ConflictException(clash.code === code ? 'کد این واحد اکنون برای واحد دیگری استفاده شده است' : 'واحدی با همین نام فارسی اکنون وجود دارد');
    const row = await tx.unit.create({ data: scalarData('Unit', record) as never });
    await this.audit.log({ userId, ipAddress, action: 'UNIT_RESTORED', entityType: AUDIT_ENTITY.UNIT, entityId: row.id, details: `${row.code} — ${row.nameFa}` }, tx);
    return { entityId: row.id };
  }
}
