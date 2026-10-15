import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';

// A deleted role comes back with its name and the permissions it had (only
// those that still exist). It has no users — those were moved before deletion.
@Injectable()
export class RolesRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.ROLE;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const name = String(record.name);
    if (await tx.role.findUnique({ where: { name } })) throw new ConflictException('نقشی با همین نام اکنون وجود دارد');
    const codes = Array.isArray(record.permissionCodes) ? (record.permissionCodes as string[]) : [];
    const permissions = await tx.permission.findMany({ where: { name: { in: codes } } });
    const role = await tx.role.create({ data: { id: Number(record.id), name, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
    await this.audit.log({ userId, ipAddress, action: 'ROLE_RESTORED', entityType: AUDIT_ENTITY.ROLE, entityId: role.id, details: `${name} · ${permissions.length} دسترسی` }, tx);
    const missing = codes.length - permissions.length;
    return { entityId: role.id, warnings: missing > 0 ? [`${missing} دسترسی قدیمی دیگر وجود ندارد و بازگردانده نشد.`] : [] };
  }
}
