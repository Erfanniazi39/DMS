import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { scalarData } from '../audit/restore/snapshot-data';

@Injectable()
export class DepartmentsRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.DEPARTMENT;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const code = String(record.code);
    const name = String(record.name);
    const clash = await tx.department.findFirst({ where: { OR: [{ code }, { name }] }, select: { code: true } });
    if (clash) throw new ConflictException(clash.code === code ? 'کد این دپارتمان اکنون برای دپارتمان دیگری استفاده شده است' : 'دپارتمانی با همین نام اکنون وجود دارد');
    const row = await tx.department.create({ data: scalarData('Department', record) as never });
    await this.audit.log({ userId, ipAddress, action: 'DEPARTMENT_RESTORED', entityType: AUDIT_ENTITY.DEPARTMENT, entityId: row.id, details: `${row.code} — ${row.name}` }, tx);
    return { entityId: row.id };
  }
}
