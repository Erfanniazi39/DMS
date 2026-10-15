import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { scalarData } from '../audit/restore/snapshot-data';

// A customer can only be deleted while it has no contacts, addresses, bank
// accounts, notes, documents or complaints, so the snapshot is the header plus
// its financial-policy profile. The national ID was masked in the archive and
// cannot come back — it is restored empty and must be entered again (the
// customer then shows the «ناقص» marker until it is).
@Injectable()
export class CustomersRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.CUSTOMER;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const lostNationalId = record.nationalId === '***';
    const row = await tx.customer.create({ data: scalarData('Customer', record) as never });
    const profile = record.financialProfile;
    if (profile && typeof profile === 'object') {
      await tx.customerFinancialProfile.create({ data: scalarData('CustomerFinancialProfile', profile as Record<string, unknown>) as never });
    }
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_RESTORED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: row.id, details: row.customerNumber }, tx);
    return { entityId: row.id, warnings: lostNationalId ? ['کد ملی / شناسه ملی هنگام حذف به‌دلایل امنیتی ذخیره نشده بود؛ باید دوباره وارد شود.'] : [] };
  }
}
